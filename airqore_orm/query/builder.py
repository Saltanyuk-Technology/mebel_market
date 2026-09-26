from copy import copy

from ..exceptions import ModelDeclarationError, QueryBuildError, RequiredFieldError
from ..models import get_model_meta, is_model_class
from .expressions import (
    BinaryExpression,
    Column,
    Expression,
    Join,
    Ordering,
    RawSQL,
    Selection,
    Value,
)


def default_alias(table):
    name = str(table).split(".")[-1]
    return "".join(part[0] for part in name.split("_") if part) or "t"


class MutationQuery:
    def __init__(
        self,
        table,
        operation,
        values=None,
        rows=(),
        filters=None,
        returning_fields=(),
        conflict_target=(),
        update_columns=(),
        allow_unfiltered=False,
        batch_size=None,
    ):
        self.table = table
        self.operation = operation
        self.values = values or {}
        self.rows = tuple(rows)
        self.filters = list(filters or ())
        self.returning_fields = tuple(returning_fields)
        self.conflict_target = tuple(conflict_target)
        self.update_columns = tuple(update_columns)
        self.allow_unfiltered = allow_unfiltered
        self.batch_size = batch_size

    def returning(self, *fields):
        query = copy(self)
        query.returning_fields = tuple(fields)
        return query

    def allow_all(self):
        query = copy(self)
        query.allow_unfiltered = True
        return query


class TableQuery:
    def __init__(self, table, *, relations=None, alias=None, executor=None):
        self.model_meta = get_model_meta(table) if is_model_class(table) else None
        self.table = self.model_meta.qualified_table if self.model_meta else str(table)
        self.alias = alias or default_alias(self.table)
        self.relations = relations
        self.executor = executor
        self.columns = []
        self.filters = []
        self.joins = []
        self.distinct_fields = ()
        self.ordering = []
        self.limit_count = None
        self.offset_count = None

    def _copy(self):
        query = copy(self)
        query.columns = list(self.columns)
        query.filters = list(self.filters)
        query.joins = list(self.joins)
        query.ordering = list(self.ordering)
        return query

    def select(self, *columns):
        query = self._copy()
        for column in columns or ("*",):
            if isinstance(column, Column):
                model = getattr(query.model_meta, "model", None)
                source = query.alias if column.model in {None, model} else None
                query.columns.append(Selection(source, column.column))
                continue

            expression, _separator, label = str(column).partition(" AS ")
            path = expression.strip().split(".")
            if len(path) == 1:
                query.columns.append(Selection(query.alias, path[0], label or None))
                continue

            relation_name, field_name = path[-2:]
            join = query._relation_join(relation_name, "LEFT JOIN")
            label = label or f"{relation_name}_{field_name}"
            query.columns.append(Selection(join.alias, field_name, label))
        return query

    def where(self, *conditions, **filters):
        query = self._copy()
        for condition in conditions:
            if not isinstance(condition, Expression):
                raise QueryBuildError(
                    "where() принимает SQL-выражения; для сырого SQL используйте RawSQL."
                )
            query.filters.append(condition)
        for name, value in filters.items():
            column = query._column(name)
            if query.model_meta is not None and value is not None:
                value = query.model_meta.require_field(name).serialize(value)
            query.filters.append(BinaryExpression(column, "=", Value(value)))
        return query

    def _column(self, field):
        if isinstance(field, Column):
            return field
        if self.model_meta is None:
            return Column(None, str(field), str(field))
        field_obj = self.model_meta.require_field(str(field))
        return Column(self.model_meta.model, field_obj.name, field_obj.column)

    def join_table(
        self,
        table,
        *,
        alias=None,
        from_alias=None,
        local_key=None,
        foreign_key="id",
        reverse=False,
        select=None,
        prefix=None,
    ):
        query = self._copy()
        target_meta = get_model_meta(table)
        target = target_meta.qualified_table if target_meta else str(table)
        relation = query.relations.find_target(query.table, target) if query.relations else None
        if relation:
            source_columns, target_columns = relation.source_columns, relation.target_columns
        elif reverse:
            source_columns = (foreign_key,)
            target_columns = (local_key or f"{query.table.rstrip('s')}_id",)
        else:
            source_columns = (local_key or f"{target.rstrip('s')}_id",)
            target_columns = (foreign_key,)
        join = Join(
            target,
            alias or default_alias(target),
            from_alias or query.alias,
            source_columns,
            target_columns,
        )
        query.joins.append(join)
        if select:
            query._pick(join.alias, select, prefix)
        return query

    def join_related(self, relation_name, *, select=None, prefix=None):
        query = self._copy()
        join = query._relation_join(relation_name, "JOIN")
        if select:
            query._pick(join.alias, select, prefix or relation_name)
        return query

    def _relation_join(self, relation_name, kind):
        relation = self.relations.resolve(self.table, relation_name) if self.relations else None
        if relation is None:
            raise QueryBuildError(f"Не найдена связь {relation_name!r} для таблицы {self.table!r}.")
        existing = next((item for item in self.joins if item.table == relation.target_table), None)
        if existing:
            return existing
        join = Join(
            relation.target_table,
            relation.alias or default_alias(relation.target_table),
            self.alias,
            relation.source_columns,
            relation.target_columns,
            kind,
        )
        self.joins.append(join)
        return join

    def pick(self, source, *fields, prefix=None):
        query = self._copy()
        query._pick(source, fields, prefix)
        return query

    def _pick(self, source, fields, prefix):
        source_alias = self.alias if source in {self.table, self.alias} else source
        for field_name in fields or ("*",):
            label = f"{prefix}_{field_name}" if prefix and field_name != "*" else None
            self.columns.append(Selection(source_alias, field_name, label))

    def distinct(self, *fields):
        query = self._copy()
        query.distinct_fields = tuple(self._column(item) for item in fields) or ("*",)
        return query

    def order_by(self, *clauses):
        query = self._copy()
        for clause in clauses:
            if isinstance(clause, Ordering):
                query.ordering.append(clause)
            else:
                query.ordering.append(self._column(clause).asc())
        return query

    def limit(self, count):
        if not isinstance(count, int) or count < 1:
            raise QueryBuildError("LIMIT должен быть положительным целым числом.")
        query = self._copy()
        query.limit_count = count
        return query

    def offset(self, count):
        if not isinstance(count, int) or count < 0:
            raise QueryBuildError("OFFSET должен быть целым неотрицательным числом.")
        query = self._copy()
        query.offset_count = count
        return query

    def page_after(self, field, value, *, size=100):
        column = self._column(field)
        return self.where(column > value).order_by(column.asc()).limit(size)

    async def all(self):
        executor = self._require_executor()
        model = self.model_meta.model if self.model_meta else None
        return await executor.fetch_all(self, as_type=model)

    async def first(self):
        executor = self._require_executor()
        model = self.model_meta.model if self.model_meta else None
        return await executor.fetch_one(self, as_type=model)

    async def exists(self):
        executor = self._require_executor()
        return await executor.fetch_val(self.limit(1)) is not None

    def _require_executor(self):
        if self.executor is None:
            raise QueryBuildError("Запрос не привязан к ORM; выполните его через ORM или Session.")
        return self.executor

    def insert(self, returning=None, **values):
        serialized = _serialize_values(self.model_meta, values, insert=True)
        return _returning(
            MutationQuery(self.table, "insert", values=serialized), returning, self.model_meta
        )

    def bulk_insert(self, rows, returning=None, *, batch_size=None):
        serialized = tuple(_serialize_values(self.model_meta, row, insert=True) for row in rows)
        query = MutationQuery(self.table, "bulk_insert", rows=serialized, batch_size=batch_size)
        return _returning(query, returning, self.model_meta)

    def update(self, returning=None, **values):
        serialized = _serialize_values(self.model_meta, values, update=True)
        query = MutationQuery(self.table, "update", serialized, filters=list(self.filters))
        return _returning(query, returning, self.model_meta)

    def delete(self, returning=None):
        query = MutationQuery(self.table, "delete", filters=list(self.filters))
        return _returning(query, returning, self.model_meta)

    def upsert(self, conflict_target, update_columns=None, returning=None, **values):
        serialized = _serialize_values(self.model_meta, values, insert=True)
        target = _field_columns(self.model_meta, conflict_target)
        requested_updates = _field_columns(self.model_meta, update_columns or ())
        columns = requested_updates or tuple(name for name in serialized if name not in target)
        query = MutationQuery(
            self.table,
            "upsert",
            values=serialized,
            conflict_target=target,
            update_columns=columns,
        )
        return _returning(query, returning, self.model_meta)

    def bulk_upsert(
        self, rows, conflict_target, update_columns=None, returning=None, *, batch_size=None
    ):
        serialized = tuple(_serialize_values(self.model_meta, row, insert=True) for row in rows)
        target = _field_columns(self.model_meta, conflict_target)
        requested_updates = _field_columns(self.model_meta, update_columns or ())
        columns = requested_updates or (
            tuple(name for name in serialized[0] if name not in target) if serialized else ()
        )
        query = MutationQuery(
            self.table,
            "bulk_upsert",
            rows=serialized,
            conflict_target=target,
            update_columns=columns,
            batch_size=batch_size,
        )
        return _returning(query, returning, self.model_meta)


def _serialize_values(model_meta, values, *, insert=False, update=False):
    if model_meta is None:
        return dict(values)
    if model_meta.invalid_fields:
        message, _hint = next(iter(model_meta.invalid_fields.values()))
        raise ModelDeclarationError(message)
    result = {}
    for name, value in values.items():
        field = model_meta.require_field(name)
        result[field.column] = field.serialize(value)

    if insert:
        _add_python_defaults(model_meta, result)

    if insert or update:
        _set_update_timestamps(model_meta, result)

    if insert:
        _check_required_fields(model_meta, result)
    return result


def _add_python_defaults(model_meta, values):
    for field in model_meta.fields.values():
        if field.column not in values and field.has_default:
            values[field.column] = field.serialize(field.get_default())


def _set_update_timestamps(model_meta, values):
    for field in model_meta.fields.values():
        if field.auto_now:
            values[field.column] = RawSQL("CURRENT_TIMESTAMP")


def _check_required_fields(model_meta, values):
    missing = []
    for field in model_meta.fields.values():
        generated_id = field.primary_key and field.__class__.__name__ in {
            "IntegerField",
            "BigIntegerField",
        }
        if field.is_required_on_insert() and not generated_id and field.column not in values:
            missing.append(f"{model_meta.name}.{field.name}")
    if missing:
        raise RequiredFieldError("отсутствуют обязательные поля: " + ", ".join(missing))


def _returning(query, returning, model_meta=None):
    if returning is None:
        return query
    fields = (returning,) if isinstance(returning, (str, Column)) else tuple(returning)
    query.returning_fields = _field_columns(model_meta, fields)
    return query


def _field_columns(model_meta, names):
    columns = []
    for name in names:
        if isinstance(name, str) and name == "*":
            columns.append(name)
        elif isinstance(name, Column):
            columns.append(name.column)
        elif model_meta is not None:
            columns.append(model_meta.require_field(name).column)
        else:
            columns.append(str(name))
    return tuple(columns)
