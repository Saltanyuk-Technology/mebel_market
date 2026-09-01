from types import SimpleNamespace

from ..fields.types import ForeignKeyField
from ..naming import normalize_identifier


class DeclaredColumn(SimpleNamespace):
    def __init__(
        self,
        name,
        data_type,
        nullable,
        default=None,
        primary_key=False,
        unique=False,
        auto_generated=False,
    ):
        super().__init__(
            name=name,
            data_type=data_type,
            nullable=nullable,
            default=default,
            primary_key=primary_key,
            unique=unique,
            auto_generated=auto_generated,
        )


class DeclaredForeignKey(SimpleNamespace):
    def __init__(
        self,
        name,
        source_columns,
        target_table,
        target_columns,
        on_delete="no action",
        on_update="no action",
    ):
        super().__init__(
            name=name,
            source_columns=tuple(source_columns),
            target_table=target_table,
            target_columns=tuple(target_columns),
            on_delete=on_delete,
            on_update=on_update,
        )


class DeclaredIndex(SimpleNamespace):
    def __init__(self, columns, name=None, unique=False):
        super().__init__(columns=tuple(columns), name=name, unique=unique)


class DeclaredUniqueConstraint(SimpleNamespace):
    def __init__(self, columns, name=None):
        super().__init__(columns=tuple(columns), name=name)


class DeclaredCheckConstraint(SimpleNamespace):
    def __init__(self, expression, name=None):
        super().__init__(expression=expression, name=name)


class DeclaredTable(SimpleNamespace):
    def __init__(
        self,
        name,
        columns,
        primary_key,
        indexes=(),
        unique_constraints=(),
        check_constraints=(),
        foreign_keys=(),
        managed=True,
    ):
        super().__init__(
            name=name,
            columns=tuple(columns),
            primary_key=tuple(primary_key),
            indexes=tuple(indexes),
            unique_constraints=tuple(unique_constraints),
            check_constraints=tuple(check_constraints),
            foreign_keys=tuple(foreign_keys),
            managed=managed,
        )


class DeclaredSchemaState(SimpleNamespace):
    def __init__(self, tables):
        super().__init__(tables=tuple(tables))

    def to_dict(self):
        return {"tables": [_schema_json_value(table) for table in self.tables]}


def _schema_json_value(value):
    if isinstance(value, SimpleNamespace):
        return {name: _schema_json_value(item) for name, item in vars(value).items()}
    if isinstance(value, tuple):
        return [_schema_json_value(item) for item in value]
    return value


class DeclaredSchemaStateBuilder:
    def __init__(self, registry):
        self.registry = registry

    def build(self):
        tables = []
        for model in self.registry.all():
            if model._meta.meta.managed:
                tables.append(self._build_table(model._meta))
        return DeclaredSchemaState(sorted(tables, key=lambda table: table.name))

    def _build_table(self, meta):
        columns = tuple(self._build_column(field) for field in meta.fields.values())
        return DeclaredTable(
            name=meta.qualified_table,
            columns=columns,
            primary_key=tuple(field.column for field in meta.fields.values() if field.primary_key),
            indexes=self._build_indexes(meta),
            unique_constraints=self._build_unique_constraints(meta),
            check_constraints=(
                DeclaredCheckConstraint(item.expression, item.name)
                for item in meta.meta.constraints
            ),
            foreign_keys=self._build_foreign_keys(meta),
        )

    @staticmethod
    def _build_indexes(meta):
        indexes = []
        for field in meta.fields.values():
            if field.index or isinstance(field, ForeignKeyField) and not field.unique:
                indexes.append(DeclaredIndex((field.column,)))
        for index in meta.meta.indexes:
            columns = tuple(meta.require_field(name).column for name in index.columns)
            indexes.append(DeclaredIndex(columns, index.name, index.unique))

        # Одинаковый индекс может прийти из поля и из Meta. Оставляем только один.
        unique_indexes = {}
        for index in indexes:
            unique_indexes[(index.columns, index.name, index.unique)] = index
        return tuple(unique_indexes.values())

    @staticmethod
    def _build_unique_constraints(meta):
        constraints = []
        for field in meta.fields.values():
            if field.unique:
                constraints.append(DeclaredUniqueConstraint((field.column,)))
        for constraint in meta.meta.uniques:
            columns = tuple(meta.require_field(name).column for name in constraint.columns)
            constraints.append(DeclaredUniqueConstraint(columns, constraint.name))

        unique_constraints = {}
        for constraint in constraints:
            unique_constraints[(constraint.columns, constraint.name)] = constraint
        return tuple(unique_constraints.values())

    @staticmethod
    def _build_foreign_keys(meta):
        foreign_keys = []
        for field in meta.fields.values():
            if not isinstance(field, ForeignKeyField):
                continue
            target_table, target_column = field.resolve_reference()
            if not target_table or not target_column:
                continue
            target_table = normalize_identifier(target_table)
            name = f"fk_{meta.table_name}_{field.column}_{target_table.replace('.', '_')}"
            foreign_keys.append(
                DeclaredForeignKey(
                    name=name,
                    source_columns=(field.column,),
                    target_table=target_table,
                    target_columns=(target_column,),
                    on_delete=field.on_delete,
                    on_update=field.on_update,
                )
            )
        return tuple(foreign_keys)

    @staticmethod
    def _build_column(field):
        data_type = field.declared_db_type() or "text"
        generated = field.primary_key and data_type in {"smallint", "integer", "bigint"}
        return DeclaredColumn(
            name=field.column,
            data_type=data_type,
            nullable=field.null,
            default=field.resolved_server_default(),
            primary_key=field.primary_key,
            unique=field.unique,
            auto_generated=generated,
        )
