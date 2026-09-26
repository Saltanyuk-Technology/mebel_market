import re
from collections import defaultdict
from types import SimpleNamespace

from ..naming import normalize_identifier, qualified_name

ACTION_PATTERN = re.compile(r"ON (DELETE|UPDATE) ([A-Z ]+?)(?: ON|$)")


class ColumnMetadata(SimpleNamespace):
    def __init__(self, name, data_type="", is_nullable=True, default=None, is_identity=False):
        super().__init__(
            name=name,
            data_type=data_type,
            is_nullable=is_nullable,
            default=default,
            is_identity=is_identity,
        )


class UniqueConstraintInfo(SimpleNamespace):
    def __init__(self, table, columns, is_primary=False, name=None):
        super().__init__(table=table, columns=tuple(columns), is_primary=is_primary, name=name)


class CheckConstraintInfo(SimpleNamespace):
    def __init__(self, table, expression, name=None):
        super().__init__(table=table, expression=expression, name=name)


class IndexMetadata(SimpleNamespace):
    def __init__(self, name, table, columns, unique=False):
        super().__init__(name=name, table=table, columns=tuple(columns), unique=unique)


class ForeignKeyInfo(SimpleNamespace):
    def __init__(
        self,
        name,
        source_table,
        target_table,
        source_columns,
        target_columns,
        is_unique=False,
        on_delete=None,
        on_update=None,
    ):
        super().__init__(
            name=name,
            source_table=source_table,
            target_table=target_table,
            source_columns=tuple(source_columns),
            target_columns=tuple(target_columns),
            is_unique=is_unique,
            on_delete=on_delete,
            on_update=on_update,
        )


class TableMetadata(SimpleNamespace):
    def __init__(
        self,
        name,
        columns=(),
        column_map=None,
        primary_key=(),
        primary_key_name=None,
        unique_constraints=(),
        indexes=(),
        check_constraints=(),
        outgoing_foreign_keys=(),
        incoming_foreign_keys=(),
    ):
        super().__init__(
            name=name,
            columns=tuple(columns),
            column_map=column_map or {},
            primary_key=tuple(primary_key),
            primary_key_name=primary_key_name,
            unique_constraints=tuple(unique_constraints),
            indexes=tuple(indexes),
            check_constraints=tuple(check_constraints),
            outgoing_foreign_keys=tuple(outgoing_foreign_keys),
            incoming_foreign_keys=tuple(incoming_foreign_keys),
        )


class DatabaseMetadata(SimpleNamespace):
    def __init__(self, tables=None):
        super().__init__(tables=tables or {})


def _constraint_action(constraint_def, kind):
    for action_kind, value in ACTION_PATTERN.findall(constraint_def):
        if action_kind == kind:
            return value.strip().lower()
    return "no action"


async def _fetch_columns(session):
    return await session.fetch(
        """
        SELECT
            ns.nspname AS schema_name,
            cls.relname AS table_name,
            att.attname AS column_name,
            pg_catalog.format_type(att.atttypid, att.atttypmod) AS data_type,
            NOT att.attnotnull AS is_nullable,
            pg_get_expr(def.adbin, def.adrelid) AS column_default,
            (att.attidentity <> '') AS is_identity
        FROM pg_class AS cls
        JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
        JOIN pg_attribute AS att
            ON att.attrelid = cls.oid
           AND att.attnum > 0
           AND NOT att.attisdropped
        LEFT JOIN pg_attrdef AS def
            ON def.adrelid = cls.oid
           AND def.adnum = att.attnum
        WHERE cls.relkind IN ('r', 'p')
          AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY ns.nspname, cls.relname, att.attnum
        """,
    )


async def _fetch_primary_keys(session):
    return await session.fetch(
        """
        SELECT
            ns.nspname AS schema_name,
            cls.relname AS table_name,
            att.attname AS column_name,
            con.conname AS constraint_name,
            key_pos.ordinality AS column_order
        FROM pg_index AS idx
        JOIN pg_class AS cls ON cls.oid = idx.indrelid
        JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
        JOIN pg_constraint AS con ON con.conindid = idx.indexrelid AND con.contype = 'p'
        JOIN unnest(idx.indkey) WITH ORDINALITY AS key_pos(attnum, ordinality) ON TRUE
        JOIN pg_attribute AS att ON att.attrelid = cls.oid AND att.attnum = key_pos.attnum
        WHERE idx.indisprimary
        ORDER BY ns.nspname, cls.relname, key_pos.ordinality
        """,
    )


async def _fetch_unique_constraints(session):
    return await session.fetch(
        """
        SELECT
            ns.nspname AS schema_name,
            cls.relname AS table_name,
            con.conname AS constraint_name,
            idx.indisprimary AS is_primary,
            array_agg(att.attname ORDER BY key_pos.ordinality) AS columns
        FROM pg_index AS idx
        JOIN pg_class AS cls ON cls.oid = idx.indrelid
        JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
        JOIN pg_class AS index_cls ON index_cls.oid = idx.indexrelid
        LEFT JOIN pg_constraint AS con ON con.conindid = idx.indexrelid
        JOIN unnest(idx.indkey) WITH ORDINALITY AS key_pos(attnum, ordinality) ON TRUE
        JOIN pg_attribute AS att ON att.attrelid = cls.oid AND att.attnum = key_pos.attnum
        WHERE idx.indisunique
          AND con.contype IN ('u', 'p')
          AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
        GROUP BY ns.nspname, cls.relname, con.conname, idx.indexrelid, idx.indisprimary
        """,
    )


async def _fetch_indexes(session):
    return await session.fetch(
        """
        SELECT
            ns.nspname AS schema_name,
            cls.relname AS table_name,
            index_cls.relname AS index_name,
            idx.indisunique AS is_unique,
            array_agg(att.attname ORDER BY key_pos.ordinality) AS columns
        FROM pg_index AS idx
        JOIN pg_class AS cls ON cls.oid = idx.indrelid
        JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
        JOIN pg_class AS index_cls ON index_cls.oid = idx.indexrelid
        LEFT JOIN pg_constraint AS con ON con.conindid = idx.indexrelid
        JOIN unnest(idx.indkey) WITH ORDINALITY AS key_pos(attnum, ordinality) ON TRUE
        JOIN pg_attribute AS att ON att.attrelid = cls.oid AND att.attnum = key_pos.attnum
        WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
          AND NOT idx.indisprimary
          AND con.oid IS NULL
        GROUP BY ns.nspname, cls.relname, index_cls.relname, idx.indisunique
        """,
    )


async def _fetch_check_constraints(session):
    return await session.fetch(
        """
        SELECT
            ns.nspname AS schema_name,
            cls.relname AS table_name,
            con.conname AS constraint_name,
            pg_get_constraintdef(con.oid, true) AS constraint_def
        FROM pg_constraint AS con
        JOIN pg_class AS cls ON cls.oid = con.conrelid
        JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
        WHERE con.contype = 'c'
          AND ns.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY ns.nspname, cls.relname, con.conname
        """,
    )


async def _fetch_foreign_keys(session):
    return await session.fetch(
        """
        SELECT
            con.conname AS constraint_name,
            src_ns.nspname AS source_schema,
            src.relname AS source_table,
            tgt_ns.nspname AS target_schema,
            tgt.relname AS target_table,
            array_agg(src_att.attname ORDER BY src_pos.ordinality) AS source_columns,
            array_agg(tgt_att.attname ORDER BY src_pos.ordinality) AS target_columns,
            pg_get_constraintdef(con.oid) AS constraint_def
        FROM pg_constraint AS con
        JOIN pg_class AS src ON src.oid = con.conrelid
        JOIN pg_namespace AS src_ns ON src_ns.oid = src.relnamespace
        JOIN pg_class AS tgt ON tgt.oid = con.confrelid
        JOIN pg_namespace AS tgt_ns ON tgt_ns.oid = tgt.relnamespace
        JOIN unnest(con.conkey) WITH ORDINALITY AS src_pos(attnum, ordinality) ON TRUE
        JOIN unnest(con.confkey) WITH ORDINALITY AS tgt_pos(attnum, ordinality) ON tgt_pos.ordinality = src_pos.ordinality
        JOIN pg_attribute AS src_att ON src_att.attrelid = src.oid AND src_att.attnum = src_pos.attnum
        JOIN pg_attribute AS tgt_att ON tgt_att.attrelid = tgt.oid AND tgt_att.attnum = tgt_pos.attnum
        WHERE con.contype = 'f'
          AND src_ns.nspname NOT IN ('pg_catalog', 'information_schema')
          AND tgt_ns.nspname NOT IN ('pg_catalog', 'information_schema')
        GROUP BY con.oid, con.conname, src_ns.nspname, src.relname, tgt_ns.nspname, tgt.relname
        """,
    )


def _collect_columns(rows):
    table_columns = defaultdict(list)
    column_map = defaultdict(dict)
    for row in rows:
        qualified = qualified_name(row["schema_name"], row["table_name"])
        table_name = normalize_identifier(qualified)
        column_name = str(row["column_name"])
        table_columns[table_name].append(column_name)
        column_map[table_name][column_name] = ColumnMetadata(
            name=column_name,
            data_type=str(row["data_type"] or ""),
            is_nullable=bool(row["is_nullable"]),
            default=row["column_default"],
            is_identity=bool(row["is_identity"]),
        )
    return table_columns, column_map


def _collect_primary_keys(rows):
    keys = defaultdict(list)
    names = {}
    for row in rows:
        table = normalize_identifier(qualified_name(row["schema_name"], row["table_name"]))
        keys[table].append(str(row["column_name"]))
        names[table] = str(row["constraint_name"])
    return keys, names


def _collect_unique_constraints(rows):
    constraints = defaultdict(list)
    for row in rows:
        table = normalize_identifier(qualified_name(row["schema_name"], row["table_name"]))
        constraints[table].append(
            UniqueConstraintInfo(
                table=table,
                columns=tuple(str(column) for column in row["columns"] or ()),
                is_primary=bool(row["is_primary"]),
                name=row["constraint_name"],
            )
        )
    return constraints


def _collect_indexes(rows):
    indexes = defaultdict(list)
    for row in rows:
        table = normalize_identifier(qualified_name(row["schema_name"], row["table_name"]))
        indexes[table].append(
            IndexMetadata(
                name=str(row["index_name"]),
                table=table,
                columns=tuple(str(column) for column in row["columns"] or ()),
                unique=bool(row["is_unique"]),
            )
        )
    return indexes


def _collect_checks(rows):
    checks = defaultdict(list)
    for row in rows:
        table = normalize_identifier(qualified_name(row["schema_name"], row["table_name"]))
        checks[table].append(
            CheckConstraintInfo(
                table=table,
                expression=str(row["constraint_def"] or ""),
                name=str(row["constraint_name"]),
            )
        )
    return checks


def _build_tables(table_rows, primary_key_rows, unique_rows, index_rows, check_rows):
    table_columns, column_map = _collect_columns(table_rows)
    primary_keys, primary_key_names = _collect_primary_keys(primary_key_rows)
    unique_by_table = _collect_unique_constraints(unique_rows)
    indexes_by_table = _collect_indexes(index_rows)
    checks_by_table = _collect_checks(check_rows)

    tables = {
        table_name: TableMetadata(
            name=table_name,
            columns=tuple(columns),
            column_map=column_map[table_name],
            primary_key=tuple(primary_keys.get(table_name, ())),
            primary_key_name=primary_key_names.get(table_name),
            unique_constraints=tuple(unique_by_table.get(table_name, ())),
            indexes=tuple(indexes_by_table.get(table_name, ())),
            check_constraints=tuple(checks_by_table.get(table_name, ())),
        )
        for table_name, columns in table_columns.items()
    }
    return tables, unique_by_table


def _attach_foreign_keys(tables, unique_by_table, foreign_key_rows):
    unique_sets = {
        (table_name, constraint.columns)
        for table_name, constraints in unique_by_table.items()
        for constraint in constraints
    }
    outgoing = defaultdict(list)
    incoming = defaultdict(list)
    for row in foreign_key_rows:
        source_table = normalize_identifier(
            qualified_name(row["source_schema"], row["source_table"])
        )
        target_table = normalize_identifier(
            qualified_name(row["target_schema"], row["target_table"])
        )
        source_columns = tuple(str(column) for column in row["source_columns"] or ())
        target_columns = tuple(str(column) for column in row["target_columns"] or ())
        relation = ForeignKeyInfo(
            name=str(row["constraint_name"]),
            source_table=source_table,
            target_table=target_table,
            source_columns=source_columns,
            target_columns=target_columns,
            is_unique=(source_table, source_columns) in unique_sets,
            on_delete=_constraint_action(str(row["constraint_def"] or ""), "DELETE"),
            on_update=_constraint_action(str(row["constraint_def"] or ""), "UPDATE"),
        )
        outgoing[source_table].append(relation)
        incoming[target_table].append(relation)

    for table_name, table in list(tables.items()):
        table.outgoing_foreign_keys = tuple(outgoing.get(table_name, ()))
        table.incoming_foreign_keys = tuple(incoming.get(table_name, ()))


async def introspect_database_metadata(session):
    # Эти запросы запускаются только для проверки схемы и миграций.
    table_rows = await _fetch_columns(session)
    primary_key_rows = await _fetch_primary_keys(session)
    unique_rows = await _fetch_unique_constraints(session)
    index_rows = await _fetch_indexes(session)
    foreign_key_rows = await _fetch_foreign_keys(session)
    check_rows = await _fetch_check_constraints(session)

    tables, unique_by_table = _build_tables(
        table_rows,
        primary_key_rows,
        unique_rows,
        index_rows,
        check_rows,
    )
    _attach_foreign_keys(tables, unique_by_table, foreign_key_rows)
    return DatabaseMetadata(tables=tables)
