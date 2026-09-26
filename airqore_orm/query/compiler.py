import re

from ..exceptions import QueryBuildError, UnsafeSQLError
from .builder import MutationQuery, TableQuery
from .expressions import (
    BetweenExpression,
    BinaryExpression,
    BooleanExpression,
    Column,
    InExpression,
    RawSQL,
    Value,
)

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
POSTGRES_PARAMETER_LIMIT = 65535


class CompiledQuery:
    def __init__(self, sql, params):
        self.sql = sql
        self.params = tuple(params)


class SQLParameters:
    def __init__(self):
        self.params = []

    def add(self, value):
        if len(self.params) >= POSTGRES_PARAMETER_LIMIT:
            raise QueryBuildError(
                "Запрос превысил лимит PostgreSQL в 65535 параметров; уменьшите batch_size."
            )
        self.params.append(value)
        return f"${len(self.params)}"

    def placeholder(self, value):
        if isinstance(value, RawSQL):
            return self.raw_sql(value)
        return self.add(value)

    def raw_sql(self, fragment):
        sql = fragment.sql
        if sql.count("?") != len(fragment.params):
            raise QueryBuildError("Количество ? не совпадает с числом параметров SQL-фрагмента.")
        for value in fragment.params:
            sql = sql.replace("?", self.add(value), 1)
        return sql


def quote_ident(name):
    parts = str(name).split(".")
    if not all(IDENTIFIER.fullmatch(part) for part in parts):
        raise UnsafeSQLError(f"Небезопасный SQL-идентификатор: {name!r}.")
    return ".".join(f'"{part}"' for part in parts)


def compile_query(query):
    if isinstance(query, TableQuery):
        return _compile_select(query)
    if isinstance(query, MutationQuery):
        return _compile_mutation(query)
    raise QueryBuildError(f"Неподдерживаемый тип запроса: {type(query).__name__}.")


def _compile_select(query):
    parameters = SQLParameters()
    alias = _validate_alias(query.alias)
    selections = query.columns or []
    columns = ", ".join(_compile_selection(item) for item in selections) or f"{alias}.*"
    distinct = _compile_distinct(query)
    parts = [f"SELECT {distinct}{columns} FROM {quote_ident(query.table)} {alias}"]
    parts.extend(_compile_join(join) for join in query.joins)
    where = _compile_filters(query.filters, query, parameters)
    if where:
        parts.append("WHERE " + " AND ".join(where))
    if query.ordering:
        parts.append(
            "ORDER BY " + ", ".join(_compile_order(item, query) for item in query.ordering)
        )
    if query.limit_count is not None:
        parts.append(f"LIMIT {query.limit_count}")
    if query.offset_count is not None:
        parts.append(f"OFFSET {query.offset_count}")
    return CompiledQuery(" ".join(parts), parameters.params)


def _compile_selection(selection):
    source = _validate_alias(selection.source) if selection.source else None
    if selection.field == "*":
        expression = f"{source}.*" if source else "*"
    else:
        expression = (
            f"{source}.{quote_ident(selection.field)}" if source else quote_ident(selection.field)
        )
    if selection.label:
        expression += f" AS {_validate_alias(selection.label)}"
    return expression


def _compile_distinct(query):
    if not query.distinct_fields:
        return ""
    if (
        len(query.distinct_fields) == 1
        and isinstance(query.distinct_fields[0], str)
        and query.distinct_fields[0] == "*"
    ):
        return "DISTINCT "
    fields = ", ".join(_compile_column(field, query) for field in query.distinct_fields)
    return f"DISTINCT ON ({fields}) "


def _compile_join(join):
    alias = _validate_alias(join.alias)
    source_alias = _validate_alias(join.source_alias)
    if join.kind not in {"JOIN", "LEFT JOIN"}:
        raise QueryBuildError(f"Неподдерживаемый JOIN: {join.kind!r}.")
    pairs = zip(join.source_columns, join.target_columns, strict=True)
    on = " AND ".join(
        f"{source_alias}.{quote_ident(source)} = {alias}.{quote_ident(target)}"
        for source, target in pairs
    )
    return f"{join.kind} {quote_ident(join.table)} {alias} ON {on}"


def _validate_alias(value):
    if not IDENTIFIER.fullmatch(str(value)):
        raise UnsafeSQLError(f"Небезопасный SQL-алиас: {value!r}.")
    return str(value)


def _compile_order(clause, query):
    if clause.direction not in {"ASC", "DESC"}:
        raise QueryBuildError(f"Неподдерживаемое направление сортировки: {clause.direction!r}.")
    if clause.nulls not in {None, "FIRST", "LAST"}:
        raise QueryBuildError(f"Неподдерживаемый порядок NULL: {clause.nulls!r}.")
    sql = f"{_compile_column(clause.column, query)} {clause.direction}"
    if clause.nulls:
        sql += f" NULLS {clause.nulls}"
    return sql


def _compile_filters(filters, query, parameters):
    chunks = []
    for item in filters:
        if isinstance(item, RawSQL):
            chunks.append(f"({parameters.raw_sql(item)})")
        else:
            chunks.append(f"({_compile_expression(item, query, parameters)})")
    return chunks


def _compile_expression(expression, query, parameters):
    if isinstance(expression, BinaryExpression):
        return _compile_binary(expression, query, parameters)
    if isinstance(expression, BooleanExpression):
        operator = expression.operator
        if operator not in {"AND", "OR"}:
            raise QueryBuildError(f"Неизвестный логический оператор: {operator}.")
        chunks = (_compile_expression(item, query, parameters) for item in expression.expressions)
        return f" {operator} ".join(f"({chunk})" for chunk in chunks)
    if isinstance(expression, InExpression):
        column = _compile_column(expression.column, query)
        comparison = f"{column} = ANY({parameters.add(list(expression.values))})"
        return f"NOT ({comparison})" if expression.negated else comparison
    if isinstance(expression, BetweenExpression):
        column = _compile_column(expression.column, query)
        lower = parameters.add(expression.lower.value)
        upper = parameters.add(expression.upper.value)
        return f"{column} BETWEEN {lower} AND {upper}"
    raise QueryBuildError(f"Неподдерживаемое SQL-выражение: {type(expression).__name__}.")


def _compile_binary(expression, query, parameters):
    if expression.operator not in {"=", "!=", "<", "<=", ">", ">=", "LIKE", "ILIKE"}:
        raise QueryBuildError(f"Неизвестный оператор сравнения: {expression.operator}.")
    left = _compile_operand(expression.left, query, parameters)
    if isinstance(expression.right, Value) and expression.right.value is None:
        if expression.operator == "=":
            return f"{left} IS NULL"
        if expression.operator == "!=":
            return f"{left} IS NOT NULL"
        raise QueryBuildError("NULL поддерживает только сравнения = и !=.")
    right = _compile_operand(expression.right, query, parameters)
    return f"{left} {expression.operator} {right}"


def _compile_operand(expression, query, parameters):
    if isinstance(expression, Column):
        return _compile_column(expression, query)
    if isinstance(expression, Value):
        return parameters.placeholder(expression.value)
    if isinstance(expression, RawSQL):
        return parameters.raw_sql(expression)
    raise QueryBuildError(f"Неподдерживаемый операнд: {type(expression).__name__}.")


def _compile_column(column, query):
    alias = query.alias if query is not None else None
    if query is not None and column.model is not None and query.model_meta is not None:
        if column.model is not query.model_meta.model:
            target = column.model._meta.qualified_table
            join = next((item for item in query.joins if item.table == target), None)
            if join is None:
                raise QueryBuildError(
                    f"Поле {column.model.__name__}.{column.name} требует явного JOIN."
                )
            alias = join.alias
    name = quote_ident(column.column)
    return f"{_validate_alias(alias)}.{name}" if alias else name


def _compile_mutation(query):
    parameters = SQLParameters()
    if query.operation in {"insert", "upsert"}:
        sql = _compile_insert_values(query.table, query.values, parameters)
    elif query.operation in {"bulk_insert", "bulk_upsert"}:
        sql = _compile_insert_rows(query.table, query.rows, parameters)
    elif query.operation == "update":
        sql = _compile_update(query, parameters)
    elif query.operation == "delete":
        sql = _compile_delete(query, parameters)
    else:
        raise QueryBuildError(f"Неизвестная операция: {query.operation}.")
    if query.operation in {"upsert", "bulk_upsert"}:
        sql += _compile_conflict(query)
    if query.returning_fields:
        sql += " RETURNING " + ", ".join(
            _returning_field(field) for field in query.returning_fields
        )
    return CompiledQuery(sql, parameters.params)


def _compile_insert_values(table, values, parameters):
    if not values:
        return f"INSERT INTO {quote_ident(table)} DEFAULT VALUES"
    columns = ", ".join(quote_ident(name) for name in values)
    placeholders = ", ".join(parameters.placeholder(value) for value in values.values())
    return f"INSERT INTO {quote_ident(table)} ({columns}) VALUES ({placeholders})"


def _compile_insert_rows(table, rows, parameters):
    if not rows:
        raise QueryBuildError("Массовая вставка требует хотя бы одну строку.")
    columns = tuple(sorted(rows[0]))
    expected = set(columns)
    if any(set(row) != expected for row in rows):
        raise QueryBuildError("Все строки массовой вставки должны иметь одинаковые поля.")
    values = []
    for row in rows:
        values.append("(" + ", ".join(parameters.placeholder(row[name]) for name in columns) + ")")
    names = ", ".join(quote_ident(name) for name in columns)
    return f"INSERT INTO {quote_ident(table)} ({names}) VALUES {', '.join(values)}"


def _compile_update(query, parameters):
    _require_write_scope(query)
    if not query.values:
        raise QueryBuildError("UPDATE требует хотя бы одно изменяемое поле.")
    assignments = ", ".join(
        f"{quote_ident(name)} = {parameters.placeholder(value)}"
        for name, value in query.values.items()
    )
    sql = f"UPDATE {quote_ident(query.table)} SET {assignments}"
    where = _compile_filters(query.filters, None, parameters)
    return sql + (" WHERE " + " AND ".join(where) if where else "")


def _compile_delete(query, parameters):
    _require_write_scope(query)
    sql = f"DELETE FROM {quote_ident(query.table)}"
    where = _compile_filters(query.filters, None, parameters)
    return sql + (" WHERE " + " AND ".join(where) if where else "")


def _require_write_scope(query):
    if not query.filters and not query.allow_unfiltered:
        raise QueryBuildError("Операция UPDATE/DELETE без WHERE требует явного allow_all().")


def _compile_conflict(query):
    if not query.conflict_target:
        raise QueryBuildError("UPSERT требует conflict_target.")
    target = ", ".join(quote_ident(name) for name in query.conflict_target)
    if not query.update_columns:
        return f" ON CONFLICT ({target}) DO NOTHING"
    updates = ", ".join(
        f"{quote_ident(name)} = EXCLUDED.{quote_ident(name)}" for name in query.update_columns
    )
    return f" ON CONFLICT ({target}) DO UPDATE SET {updates}"


def _returning_field(field):
    if field == "*":
        return "*"
    if not IDENTIFIER.fullmatch(str(field)):
        raise UnsafeSQLError(f"Небезопасное поле RETURNING: {field!r}.")
    return str(field)
