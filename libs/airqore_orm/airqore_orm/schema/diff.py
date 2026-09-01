import re
from enum import StrEnum

from ..exceptions import QueryBuildError, UnsafeSQLError
from .inspect import DatabaseMetadata, TableMetadata

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def quote_ident(value):
    parts = str(value).split(".")
    if not parts or not all(IDENTIFIER.fullmatch(part) for part in parts):
        raise UnsafeSQLError(f"Небезопасный PostgreSQL-идентификатор: {value!r}.")
    return ".".join(f'"{part}"' for part in parts)


class MigrationRisk(StrEnum):
    SAFE = "SAFE"
    REQUIRES_LOCK = "REQUIRES_LOCK"
    DESTRUCTIVE = "DESTRUCTIVE"
    MANUAL = "MANUAL"


class SchemaOperation:
    def __init__(self, kind, summary, sql, risk=MigrationRisk.SAFE, transactional=True):
        self.kind = kind
        self.summary = summary
        self.sql = tuple(sql)
        self.risk = risk
        self.transactional = transactional

    @property
    def destructive(self):
        return self.risk == MigrationRisk.DESTRUCTIVE


class SchemaPlan:
    def __init__(self, operations, fingerprint):
        self.operations = tuple(operations)
        self.fingerprint = fingerprint

    @property
    def has_changes(self):
        return bool(self.operations)

    def render_sql(self):
        return "\n".join(statement for op in self.operations for statement in op.sql)


def ensure_destructive_allowed(plan, allow_destructive=False):
    manual = [operation for operation in plan.operations if operation.risk == MigrationRisk.MANUAL]
    if manual:
        names = ", ".join(operation.summary for operation in manual)
        raise QueryBuildError(f"Изменения требуют ручного migration SQL: {names}")

    destructive = [operation for operation in plan.operations if operation.destructive]
    if destructive and not allow_destructive:
        names = ", ".join(operation.summary for operation in destructive)
        raise QueryBuildError(
            f"Разрушающие изменения схемы требуют явного allow_destructive=True: {names}"
        )


def _normalize_data_type(data_type):
    normalized = str(data_type or "").strip().lower()
    if normalized == "timestamp without time zone":
        return "timestamp"
    if normalized == "time without time zone":
        return "time"
    if normalized == "character varying":
        return "varchar"
    return normalized


def _is_auto_generated_column(column):
    return bool(getattr(column, "auto_generated", False))


def _actual_has_auto_generation(column):
    if bool(getattr(column, "is_identity", False)):
        return True
    default = str(getattr(column, "default", "") or "").lower()
    return "nextval(" in default


def build_schema_plan(declared, actual, *, fingerprint, rename_map=None):
    rename_operations, normalized_actual = _apply_rename_map(actual, rename_map or {})
    operations = list(rename_operations)
    actual_tables = normalized_actual.tables
    created_tables = []
    ordered_declared_tables = _order_declared_tables(tuple(declared.tables), actual_tables)
    for table in ordered_declared_tables:
        table_name = table.name
        current = actual_tables.get(table_name)
        if current is None:
            operations.append(_create_table(table))
            created_tables.append(table)
            continue
        operations.extend(_alter_table(table, current))

    # Сначала создаём таблицы, затем внешние ключи между ними.
    for table in created_tables:
        operations.extend(_compare_foreign_keys(table, TableMetadata(name=table.name)))

    # Чужие таблицы из actual здесь не удаляются: ORM не владеет ими.
    return SchemaPlan(operations=tuple(operations), fingerprint=fingerprint)


def _order_declared_tables(tables, actual_tables):
    remaining = {table.name: table for table in tables}
    resolved = set(actual_tables)
    ordered = []

    while remaining:
        ready = []
        for table in remaining.values():
            dependencies = {
                fk.target_table
                for fk in table.foreign_keys
                if fk.target_table in remaining or fk.target_table in resolved
            }
            if dependencies.issubset(resolved):
                ready.append(table)
        if not ready:
            ready = [remaining[name] for name in sorted(remaining)]
        for table in sorted(ready, key=lambda item: item.name):
            if table.name not in remaining:
                continue
            ordered.append(table)
            resolved.add(table.name)
            remaining.pop(table.name, None)
    return tuple(ordered)


def _apply_rename_map(actual, rename_map):
    tables = {}
    for name, table in actual.tables.items():
        table_copy = table.__class__(**vars(table))
        table_copy.column_map = dict(table.column_map)
        tables[name] = table_copy
    operations = _rename_tables(tables, rename_map.get("tables", {}))
    operations.extend(_rename_columns(tables, rename_map.get("columns", {})))
    return operations, DatabaseMetadata(tables=tables)


def _rename_tables(tables, rename_map):
    operations = []
    for old_name, new_name in dict(rename_map or {}).items():
        table = tables.pop(old_name, None)
        if table is None:
            continue
        old_schema, _, old_table = old_name.rpartition(".")
        new_schema, _, new_table = new_name.rpartition(".")
        if old_schema and new_schema and old_schema != new_schema:
            raise ValueError("Переименование между разными схемами пока не поддерживается.")
        table.name = new_name
        tables[new_name] = table
        _rename_foreign_key_tables(tables, old_name, new_name)
        operations.append(
            SchemaOperation(
                kind="rename_table",
                summary=f"переименовать таблицу {old_name} -> {new_name}",
                sql=(
                    f"ALTER TABLE {quote_ident(old_name)} RENAME TO {quote_ident(new_table or new_name)}",
                ),
                risk=MigrationRisk.REQUIRES_LOCK,
            )
        )
    return operations


def _rename_foreign_key_tables(tables, old_name, new_name):
    for table in tables.values():
        table.outgoing_foreign_keys = tuple(
            _rename_foreign_key_table(foreign_key, old_name, new_name)
            for foreign_key in table.outgoing_foreign_keys
        )


def _rename_foreign_key_table(foreign_key, old_name, new_name):
    if foreign_key.target_table != old_name and foreign_key.source_table != old_name:
        return foreign_key
    renamed = foreign_key.__class__(**vars(foreign_key))
    if renamed.target_table == old_name:
        renamed.target_table = new_name
    if renamed.source_table == old_name:
        renamed.source_table = new_name
    return renamed


def _rename_columns(tables, rename_map):
    operations = []
    for table_name, mapping in dict(rename_map or {}).items():
        table = tables.get(table_name)
        if table is None:
            continue
        for old_name, new_name in dict(mapping or {}).items():
            column = table.column_map.pop(old_name, None)
            if column is None:
                continue
            renamed = column.__class__(**vars(column))
            renamed.name = new_name
            table.column_map[new_name] = renamed
            table.columns = tuple(new_name if item == old_name else item for item in table.columns)
            table.primary_key = tuple(
                new_name if item == old_name else item for item in table.primary_key
            )
            renamed_constraints = []
            for constraint in table.unique_constraints:
                constraint = constraint.__class__(**vars(constraint))
                constraint.columns = tuple(
                    new_name if item == old_name else item for item in constraint.columns
                )
                renamed_constraints.append(constraint)
            table.unique_constraints = tuple(renamed_constraints)

            renamed_indexes = []
            for index in table.indexes:
                index = index.__class__(**vars(index))
                index.columns = tuple(
                    new_name if item == old_name else item for item in index.columns
                )
                renamed_indexes.append(index)
            table.indexes = tuple(renamed_indexes)

            renamed_foreign_keys = []
            for foreign_key in table.outgoing_foreign_keys:
                foreign_key = foreign_key.__class__(**vars(foreign_key))
                foreign_key.source_columns = tuple(
                    new_name if item == old_name else item for item in foreign_key.source_columns
                )
                renamed_foreign_keys.append(foreign_key)
            table.outgoing_foreign_keys = tuple(renamed_foreign_keys)
            operations.append(
                SchemaOperation(
                    kind="rename_column",
                    summary=f"переименовать колонку {table_name}.{old_name} -> {new_name}",
                    sql=(
                        f"ALTER TABLE {quote_ident(table_name)} "
                        f"RENAME COLUMN {quote_ident(old_name)} TO {quote_ident(new_name)}",
                    ),
                    risk=MigrationRisk.REQUIRES_LOCK,
                )
            )
    return operations


def _create_table(table):
    column_sql = [_column_declaration(column) for column in table.columns]
    if table.primary_key:
        column_sql.append(
            f"PRIMARY KEY ({', '.join(quote_ident(column) for column in table.primary_key)})"
        )
    statements = [f"CREATE TABLE {quote_ident(table.name)} ({', '.join(column_sql)})"]
    statements.extend(_unique_sql(table, item) for item in table.unique_constraints)
    statements.extend(_index_sql(table, item) for item in table.indexes)
    statements.extend(_check_sql(table, item) for item in table.check_constraints)
    return SchemaOperation(
        kind="create_table", summary=f"создать таблицу {table.name}", sql=tuple(statements)
    )


def _column_declaration(column):
    sql = f"{quote_ident(column.name)} {column.data_type}"
    if _is_auto_generated_column(column):
        sql += " GENERATED BY DEFAULT AS IDENTITY"
    if not column.nullable or column.primary_key:
        sql += " NOT NULL"
    if column.default:
        sql += f" DEFAULT {column.default}"
    return sql


def _unique_sql(table, constraint):
    name = constraint.name or f"uq_{table.name.replace('.', '_')}_{'_'.join(constraint.columns)}"
    columns = ", ".join(quote_ident(item) for item in constraint.columns)
    return (
        f"ALTER TABLE {quote_ident(table.name)} ADD CONSTRAINT "
        f"{quote_ident(name)} UNIQUE ({columns})"
    )


def _index_sql(table, index):
    name = index.name or f"idx_{table.name.replace('.', '_')}_{'_'.join(index.columns)}"
    columns = ", ".join(quote_ident(item) for item in index.columns)
    unique = "UNIQUE " if index.unique else ""
    return f"CREATE {unique}INDEX {quote_ident(name)} ON {quote_ident(table.name)} ({columns})"


def _index_name(table_name, index_name):
    if "." in index_name:
        return index_name
    schema, separator, _table = table_name.rpartition(".")
    return f"{schema}.{index_name}" if separator else index_name


def _check_sql(table, constraint):
    prefix = f"CONSTRAINT {quote_ident(constraint.name)} " if constraint.name else ""
    return f"ALTER TABLE {quote_ident(table.name)} ADD {prefix}CHECK ({constraint.expression})"


def _alter_table(declared, current):
    operations = _compare_columns(declared, current)
    operations.extend(_compare_primary_key(declared, current))
    operations.extend(_compare_unique_constraints(declared, current))
    operations.extend(_compare_indexes(declared, current))
    operations.extend(_compare_check_constraints(declared, current))
    operations.extend(_compare_foreign_keys(declared, current))
    return operations


def _compare_columns(declared, current):
    operations = []
    current_columns = current.column_map
    declared_columns = {column.name: column for column in declared.columns}
    for column_name, column in declared_columns.items():
        current_column = current_columns.get(column_name)
        if current_column is None:
            operations.append(_add_column(declared.name, column))
            continue
        operations.extend(_compare_column(declared.name, column, current_column))
    for column_name in sorted(set(current_columns) - set(declared_columns)):
        operations.append(
            SchemaOperation(
                kind="drop_column",
                summary=f"удалить колонку {declared.name}.{column_name}",
                sql=(
                    f"ALTER TABLE {quote_ident(declared.name)} DROP COLUMN {quote_ident(column_name)}",
                ),
                risk=MigrationRisk.DESTRUCTIVE,
            )
        )
    return operations


def _add_column(table_name, column):
    statement = f"ALTER TABLE {quote_ident(table_name)} ADD COLUMN {quote_ident(column.name)} {column.data_type}"
    if _is_auto_generated_column(column):
        statement += " GENERATED BY DEFAULT AS IDENTITY"
    if not column.nullable:
        statement += " NOT NULL"
    if column.default:
        statement += f" DEFAULT {column.default}"
    risk = MigrationRisk.SAFE if column.nullable else MigrationRisk.REQUIRES_LOCK
    return SchemaOperation(
        kind="add_column",
        summary=f"добавить колонку {table_name}.{column.name}",
        sql=(statement,),
        risk=risk,
    )


def _compare_column(table_name, declared, current):
    type_operation = _column_type_change(table_name, declared, current)
    identity_operation = _column_identity_change(table_name, declared, current)
    null_operation = _column_nullability_change(table_name, declared, current)
    default_operation = _column_default_change(table_name, declared, current)
    return [
        operation
        for operation in (type_operation, identity_operation, null_operation, default_operation)
        if operation is not None
    ]


def _column_type_change(table_name, declared, current):
    current_type = _normalize_data_type(current.data_type)
    declared_type = _normalize_data_type(declared.data_type)
    if not current_type or not declared_type or current_type == declared_type:
        return None
    return SchemaOperation(
        kind="alter_column_type",
        summary=f"изменить тип {table_name}.{declared.name}",
        sql=(
            f"ALTER TABLE {quote_ident(table_name)} ALTER COLUMN "
            f"{quote_ident(declared.name)} TYPE {declared.data_type}",
        ),
        risk=MigrationRisk.MANUAL,
    )


def _column_identity_change(table_name, declared, current):
    if not _is_auto_generated_column(declared) or _actual_has_auto_generation(current):
        return None
    return SchemaOperation(
        kind="alter_column_identity",
        summary=f"добавить identity для {table_name}.{declared.name}",
        sql=(
            f"ALTER TABLE {quote_ident(table_name)} ALTER COLUMN {quote_ident(declared.name)} "
            "ADD GENERATED BY DEFAULT AS IDENTITY",
        ),
        risk=MigrationRisk.REQUIRES_LOCK,
    )


def _column_nullability_change(table_name, declared, current):
    if current.is_nullable == declared.nullable:
        return None
    mode = "DROP NOT NULL" if declared.nullable else "SET NOT NULL"
    return SchemaOperation(
        kind="alter_nullability",
        summary=f"изменить nullable для {table_name}.{declared.name}",
        sql=(
            f"ALTER TABLE {quote_ident(table_name)} ALTER COLUMN "
            f"{quote_ident(declared.name)} {mode}",
        ),
        risk=MigrationRisk.REQUIRES_LOCK,
    )


def _column_default_change(table_name, declared, current):
    if _normalize_default(current.default) == _normalize_default(declared.default):
        return None
    default_sql = "DROP DEFAULT" if declared.default is None else f"SET DEFAULT {declared.default}"
    return SchemaOperation(
        kind="alter_column_default",
        summary=f"изменить default для {table_name}.{declared.name}",
        sql=(
            f"ALTER TABLE {quote_ident(table_name)} ALTER COLUMN "
            f"{quote_ident(declared.name)} {default_sql}",
        ),
        risk=MigrationRisk.REQUIRES_LOCK,
    )


def _normalize_default(value):
    normalized = str(value or "").strip().lower()
    while normalized.startswith("(") and normalized.endswith(")"):
        normalized = normalized[1:-1].strip()
    if "::" in normalized:
        normalized = normalized.split("::", 1)[0].strip()
    return normalized


def _compare_primary_key(declared, current):
    declared_key = tuple(declared.primary_key)
    current_key = tuple(getattr(current, "primary_key", ()))
    if declared_key == current_key:
        return []

    operations = []
    if current_key:
        name = (
            getattr(current, "primary_key_name", None) or f"{declared.name.rsplit('.', 1)[-1]}_pkey"
        )
        operations.append(
            SchemaOperation(
                kind="drop_primary_key",
                summary=f"удалить первичный ключ {declared.name}({', '.join(current_key)})",
                sql=(
                    f"ALTER TABLE {quote_ident(declared.name)} DROP CONSTRAINT {quote_ident(name)}",
                ),
                risk=MigrationRisk.DESTRUCTIVE,
            )
        )
    if declared_key:
        operations.append(
            SchemaOperation(
                kind="add_primary_key",
                summary=f"добавить первичный ключ {declared.name}({', '.join(declared_key)})",
                sql=(
                    f"ALTER TABLE {quote_ident(declared.name)} ADD PRIMARY KEY "
                    f"({', '.join(quote_ident(column) for column in declared_key)})",
                ),
                risk=MigrationRisk.REQUIRES_LOCK,
            )
        )
    return operations


def _compare_unique_constraints(declared, current):
    operations = []
    current_unique = {
        constraint.columns: constraint
        for constraint in getattr(current, "unique_constraints", ())
        if not getattr(constraint, "is_primary", False)
    }
    declared_unique = {constraint.columns: constraint for constraint in declared.unique_constraints}
    for columns in sorted(set(declared_unique) & set(current_unique)):
        declared_constraint = declared_unique[columns]
        current_constraint = current_unique[columns]
        if declared_constraint.name and declared_constraint.name != current_constraint.name:
            operations.extend(
                _replace_unique_constraint(declared, declared_constraint, current_constraint.name)
            )
    for columns, constraint in sorted(current_unique.items(), key=lambda item: item[0]):
        if columns in declared_unique:
            continue
        constraint_name = (
            getattr(constraint, "name", None)
            or f"uq_{declared.name.replace('.', '_')}_{'_'.join(columns)}"
        )
        operations.append(
            SchemaOperation(
                kind="drop_unique",
                summary=f"удалить уникальность {declared.name}({', '.join(columns)})",
                sql=(
                    f"ALTER TABLE {quote_ident(declared.name)} DROP CONSTRAINT "
                    f"{quote_ident(constraint_name)}",
                ),
                risk=MigrationRisk.DESTRUCTIVE,
            )
        )
    for columns in sorted(set(declared_unique) - set(current_unique), key=lambda item: item):
        constraint = declared_unique[columns]
        constraint_name = (
            constraint.name or f"uq_{declared.name.replace('.', '_')}_{'_'.join(columns)}"
        )
        operations.append(
            SchemaOperation(
                kind="add_unique",
                summary=f"добавить уникальность {declared.name}({', '.join(columns)})",
                sql=(
                    f"ALTER TABLE {quote_ident(declared.name)} ADD CONSTRAINT "
                    f"{quote_ident(constraint_name)} UNIQUE "
                    f"({', '.join(quote_ident(column) for column in columns)})",
                ),
                risk=MigrationRisk.REQUIRES_LOCK,
            )
        )
    return operations


def _replace_unique_constraint(declared, constraint, current_name):
    columns = constraint.columns
    return [
        SchemaOperation(
            kind="drop_unique",
            summary=f"переименовать уникальность {declared.name}({', '.join(columns)})",
            sql=(
                f"ALTER TABLE {quote_ident(declared.name)} "
                f"DROP CONSTRAINT {quote_ident(current_name)}",
            ),
            risk=MigrationRisk.DESTRUCTIVE,
        ),
        SchemaOperation(
            kind="add_unique",
            summary=f"добавить уникальность {declared.name}({', '.join(columns)})",
            sql=(
                f"ALTER TABLE {quote_ident(declared.name)} ADD CONSTRAINT "
                f"{quote_ident(constraint.name)} UNIQUE "
                f"({', '.join(quote_ident(column) for column in columns)})",
            ),
            risk=MigrationRisk.REQUIRES_LOCK,
        ),
    ]


def _compare_indexes(declared, current):
    operations = []
    current_indexes = {
        (index.columns, bool(index.unique)): index for index in getattr(current, "indexes", ())
    }
    declared_indexes = {(index.columns, bool(index.unique)): index for index in declared.indexes}
    for signature in sorted(set(declared_indexes) & set(current_indexes), key=lambda item: item):
        declared_index = declared_indexes[signature]
        current_index = current_indexes[signature]
        if declared_index.name and declared_index.name != current_index.name:
            operations.append(
                SchemaOperation(
                    kind="rename_index",
                    summary=f"переименовать индекс {current_index.name} -> {declared_index.name}",
                    sql=(
                        f"ALTER INDEX {quote_ident(_index_name(declared.name, current_index.name))} "
                        f"RENAME TO {quote_ident(declared_index.name)}",
                    ),
                    risk=MigrationRisk.REQUIRES_LOCK,
                )
            )
    for signature, index in sorted(current_indexes.items(), key=lambda item: item[0]):
        if signature in declared_indexes:
            continue
        columns, _unique = signature
        operations.append(
            SchemaOperation(
                kind="drop_index",
                summary=f"удалить индекс {declared.name}({', '.join(columns)})",
                sql=(
                    f"DROP INDEX CONCURRENTLY "
                    f"{quote_ident(_index_name(declared.name, index.name))}",
                ),
                risk=MigrationRisk.DESTRUCTIVE,
                transactional=False,
            )
        )
    for signature in sorted(set(declared_indexes) - set(current_indexes), key=lambda item: item):
        columns, unique = signature
        index = declared_indexes[signature]
        index_name = index.name or f"idx_{declared.name.replace('.', '_')}_{'_'.join(columns)}"
        unique_sql = "UNIQUE " if unique else ""
        operations.append(
            SchemaOperation(
                kind="add_index",
                summary=f"создать индекс {declared.name}({', '.join(columns)})",
                sql=(
                    f"CREATE {unique_sql}INDEX CONCURRENTLY {quote_ident(index_name)} "
                    f"ON {quote_ident(declared.name)} ({', '.join(quote_ident(column) for column in columns)})",
                ),
                transactional=False,
            )
        )
    return operations


def _normalize_check(expression):
    normalized = " ".join(str(expression or "").strip().split())
    if normalized.upper().startswith("CHECK"):
        normalized = normalized[5:].strip()
    while normalized.startswith("(") and normalized.endswith(")"):
        normalized = normalized[1:-1].strip()
    return normalized


def _compare_check_constraints(declared, current):
    current_checks = {
        _normalize_check(constraint.expression): constraint
        for constraint in getattr(current, "check_constraints", ())
    }
    declared_checks = {
        _normalize_check(constraint.expression): constraint
        for constraint in declared.check_constraints
    }
    operations = []
    for expression in sorted(set(declared_checks) & set(current_checks)):
        declared_constraint = declared_checks[expression]
        current_constraint = current_checks[expression]
        if declared_constraint.name and declared_constraint.name != current_constraint.name:
            operations.append(
                SchemaOperation(
                    kind="rename_check",
                    summary=f"переименовать ограничение {current_constraint.name} -> {declared_constraint.name}",
                    sql=(
                        f"ALTER TABLE {quote_ident(declared.name)} RENAME CONSTRAINT "
                        f"{quote_ident(current_constraint.name)} TO "
                        f"{quote_ident(declared_constraint.name)}",
                    ),
                    risk=MigrationRisk.REQUIRES_LOCK,
                )
            )
    for expression, constraint in sorted(current_checks.items()):
        if expression in declared_checks:
            continue
        operations.append(
            SchemaOperation(
                kind="drop_check",
                summary=f"удалить ограничение {constraint.name} из {declared.name}",
                sql=(
                    f"ALTER TABLE {quote_ident(declared.name)} "
                    f"DROP CONSTRAINT {quote_ident(constraint.name)}",
                ),
                risk=MigrationRisk.DESTRUCTIVE,
            )
        )
    for expression in sorted(set(declared_checks) - set(current_checks)):
        constraint = declared_checks[expression]
        prefix = ""
        label = constraint.name or "CHECK"
        if constraint.name:
            prefix = f"CONSTRAINT {quote_ident(constraint.name)} "
        operations.append(
            SchemaOperation(
                kind="add_check",
                summary=f"добавить ограничение {label} для {declared.name}",
                sql=(
                    f"ALTER TABLE {quote_ident(declared.name)} ADD "
                    f"{prefix}CHECK ({constraint.expression})",
                ),
                risk=MigrationRisk.REQUIRES_LOCK,
            )
        )
    return operations


def _foreign_key_signature(foreign_key):
    return (
        tuple(foreign_key.source_columns),
        foreign_key.target_table,
        tuple(foreign_key.target_columns),
        str(getattr(foreign_key, "on_delete", "") or "").lower(),
        str(getattr(foreign_key, "on_update", "") or "").lower(),
    )


def _compare_foreign_keys(declared, current):
    operations = []
    current_fks = {
        _foreign_key_signature(fk): fk for fk in getattr(current, "outgoing_foreign_keys", ())
    }
    declared_fks = {_foreign_key_signature(fk): fk for fk in declared.foreign_keys}
    for signature, fk in sorted(current_fks.items(), key=lambda item: item[0]):
        if signature in declared_fks:
            continue
        operations.append(
            SchemaOperation(
                kind="drop_foreign_key",
                summary=f"удалить внешний ключ {declared.name}({', '.join(fk.source_columns)}) -> {fk.target_table}",
                sql=(
                    f"ALTER TABLE {quote_ident(declared.name)} DROP CONSTRAINT "
                    f"{quote_ident(fk.name)}",
                ),
                risk=MigrationRisk.DESTRUCTIVE,
            )
        )
    for signature, fk in sorted(declared_fks.items(), key=lambda item: item[0]):
        if signature in current_fks:
            continue
        clauses = []
        if fk.on_delete:
            clauses.append(f"ON DELETE {str(fk.on_delete).upper()}")
        if fk.on_update:
            clauses.append(f"ON UPDATE {str(fk.on_update).upper()}")
        operations.append(
            SchemaOperation(
                kind="add_foreign_key",
                summary=f"добавить внешний ключ {declared.name}({', '.join(fk.source_columns)}) -> {fk.target_table}",
                sql=(
                    f"ALTER TABLE {quote_ident(declared.name)} ADD CONSTRAINT "
                    f"{quote_ident(fk.name)} FOREIGN KEY "
                    f"({', '.join(quote_ident(c) for c in fk.source_columns)}) "
                    f"REFERENCES {quote_ident(fk.target_table)} "
                    f"({', '.join(quote_ident(c) for c in fk.target_columns)})"
                    + (f" {' '.join(clauses)}" if clauses else ""),
                ),
                risk=MigrationRisk.REQUIRES_LOCK,
            )
        )
    return operations
