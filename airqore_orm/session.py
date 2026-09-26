import asyncio
import re
from copy import copy
from time import perf_counter

from .config import ORMConfig
from .exceptions import (
    DuplicateKeyError,
    PoolTimeoutError,
    QueryBuildError,
    QueryExecutionError,
    QueryTimeoutError,
    TransactionError,
    TransientTransactionError,
)
from .models import is_model_class
from .query import MutationQuery, RawSQL, TableQuery, compile_query
from .query.compiler import POSTGRES_PARAMETER_LIMIT, quote_ident

TRANSIENT_SQLSTATES = {"40001", "40P01"}
UNIQUE_VIOLATION_SQLSTATE = "23505"


class TransactionScope:
    def __init__(self, session, **options):
        self.session = session
        self.options = options
        self.context = None
        self.started_at = None

    async def __aenter__(self):
        # Вся транзакция работает на одном соединении этой сессии.
        connection = await self.session._ensure_connection()
        self.context = connection.transaction(**self.options)
        await self.context.__aenter__()
        self.session._transaction_depth += 1
        self.started_at = perf_counter()
        return self.session

    async def __aexit__(self, exc_type, exc, traceback):
        if self.context is None:
            return None
        import asyncpg

        success = False
        try:
            result = await self.context.__aexit__(exc_type, exc, traceback)
            success = exc is None
            return result
        except asyncpg.PostgresError as database_error:
            sqlstate = getattr(database_error, "sqlstate", None)
            self.session.emit("db.query.error", operation="transaction", sqlstate=sqlstate)
            raise _database_error(database_error, sql=None, params=()) from database_error
        finally:
            self.session._transaction_depth -= 1
            duration = (perf_counter() - self.started_at) * 1000
            self.session.emit("db.transaction.duration_ms", duration_ms=duration, success=success)


class Session:
    def __init__(self, *, pool=None, connection=None, config=None, event_hook=None):
        if pool is None and connection is None:
            raise TransactionError("Сессии нужен пул или готовое соединение.")
        self.pool = pool
        self.connection = connection
        self.config = config or ORMConfig()
        self.event_hook = event_hook
        self._acquired = None
        self._transaction_depth = 0
        self._acquiring = False
        self._executing = False

    @property
    def in_transaction(self):
        return self._transaction_depth > 0

    async def __aenter__(self):
        await self._ensure_connection()
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        await self.close()

    def emit(self, event, **attributes):
        if self.event_hook is not None:
            self.event_hook(event, attributes)

    async def _ensure_connection(self):
        if self.connection is not None:
            return self.connection
        if self._acquiring:
            raise TransactionError(
                "Одну Session нельзя одновременно использовать из нескольких task."
            )
        started_at = perf_counter()
        self._acquiring = True
        try:
            # Очередью управляет только пул. Здесь есть лишь общий таймаут ожидания.
            self._acquired = await asyncio.wait_for(
                self.pool.acquire(), timeout=self.config.acquire_timeout
            )
            self.connection = self._acquired
        except TimeoutError as exc:
            raise PoolTimeoutError(
                "Не удалось получить соединение из пула PostgreSQL за acquire_timeout."
            ) from exc
        finally:
            self._acquiring = False
            try:
                self.emit("db.pool.wait_ms", duration_ms=(perf_counter() - started_at) * 1000)
            except BaseException:
                await self.close()
                raise
        return self.connection

    async def close(self):
        if self._acquired is None:
            return
        await self.pool.release(self._acquired)
        self._acquired = None
        self.connection = None

    def transaction(self, isolation=None, readonly=None, deferrable=None):
        values = {"isolation": isolation, "readonly": readonly, "deferrable": deferrable}
        return TransactionScope(
            self, **{name: value for name, value in values.items() if value is not None}
        )

    async def fetch(self, query, *args):
        if _is_bulk(query):
            return await self._fetch_bulk(query)
        sql, params = _prepare_query(query, args)
        return await self._run("fetch", sql, params)

    async def fetchrow(self, query, *args):
        if _is_bulk(query):
            rows = await self._fetch_bulk(query)
            return rows[0] if rows else None
        if isinstance(query, TableQuery):
            query = query.limit(1)
        sql, params = _prepare_query(query, args)
        return await self._run("fetchrow", sql, params)

    async def fetchval(self, query, *args):
        if isinstance(query, TableQuery):
            query = query.limit(1)
        sql, params = _prepare_query(query, args)
        return await self._run("fetchval", sql, params)

    async def execute(self, query, *args):
        if _is_bulk(query):
            return await self._execute_bulk(query)
        sql, params = _prepare_query(query, args)
        return await self._run("execute", sql, params)

    async def fetch_all(self, query, *args, **mapping):
        records = await self.fetch(query, *args)
        return [_map_row(record, **mapping) for record in records]

    async def fetch_one(self, query, *args, **mapping):
        record = await self.fetchrow(query, *args)
        return _map_row(record, **mapping)

    async def _fetch_bulk(self, query):
        records = []
        for batch in _batch_queries(query, self.config.bulk_batch_size):
            compiled = compile_query(batch)
            records.extend(await self._run("fetch", compiled.sql, compiled.params))
        return records

    async def _execute_bulk(self, query):
        if _can_copy(query):
            return await self._copy_rows(query)
        results = []
        for batch in _batch_queries(query, self.config.bulk_batch_size):
            compiled = compile_query(batch)
            results.append(await self._run("execute", compiled.sql, compiled.params))
        return results[0] if len(results) == 1 else tuple(results)

    async def _copy_rows(self, query):
        columns = _bulk_columns(query.rows)
        records = [tuple(row[name] for name in columns) for row in query.rows]
        schema, table = _split_table(query.table)
        connection = await self._ensure_connection()
        kwargs = {"records": records, "columns": columns}
        if schema is not None:
            kwargs["schema_name"] = schema
        if self.config.command_timeout is not None:
            kwargs["timeout"] = self.config.command_timeout
        return await self._run_call("copy", connection.copy_records_to_table, table, **kwargs)

    async def _run(self, method, sql, params):
        connection = await self._ensure_connection()
        call = getattr(connection, method)
        kwargs = {}
        if self.config.command_timeout is not None:
            kwargs["timeout"] = self.config.command_timeout
        return await self._run_call(method, call, sql, *params, sql=sql, params=params, **kwargs)

    async def _run_call(self, operation, call, *args, sql=None, params=(), **kwargs):
        import asyncpg

        if self._executing:
            # Одна сессия не должна незаметно превращаться в очередь запросов.
            raise TransactionError("Одна Session выполняет только один SQL-запрос одновременно.")
        started_at = perf_counter()
        self._executing = True
        try:
            return await call(*args, **kwargs)
        except TimeoutError as exc:
            self.emit("db.query.timeout", operation=operation)
            raise QueryTimeoutError(
                "Истёк timeout выполнения SQL.", sql=sql, params=params
            ) from exc
        except asyncpg.PostgresError as exc:
            sqlstate = getattr(exc, "sqlstate", None)
            self.emit("db.query.error", operation=operation, sqlstate=sqlstate)
            raise _database_error(exc, sql=sql, params=params) from exc
        finally:
            self._executing = False
            duration_ms = (perf_counter() - started_at) * 1000
            self.emit(
                "db.query.duration_ms",
                operation=operation,
                duration_ms=duration_ms,
            )
            if self.config.slow_query_ms is not None and duration_ms >= self.config.slow_query_ms:
                self.emit("db.query.slow", operation=operation, duration_ms=duration_ms)


def _prepare_query(query, args):
    if isinstance(query, (TableQuery, MutationQuery)):
        if args:
            raise QueryExecutionError(
                "Параметры query-объекта формирует Compiler; передавать args отдельно нельзя."
            )
        compiled = compile_query(query)
        return compiled.sql, compiled.params
    return str(query), tuple(args)


def _is_bulk(query):
    return isinstance(query, MutationQuery) and query.operation in {"bulk_insert", "bulk_upsert"}


def _bulk_columns(rows):
    if not rows:
        raise QueryBuildError("Массовая вставка требует хотя бы одну строку.")
    columns = tuple(sorted(rows[0]))
    expected = set(columns)
    if any(set(row) != expected for row in rows):
        raise QueryBuildError("Все строки массовой вставки должны иметь одинаковый набор полей.")
    return columns


def _batch_queries(query, default_size):
    columns = _bulk_columns(query.rows)
    requested_size = query.batch_size or default_size
    if not isinstance(requested_size, int) or requested_size < 1:
        raise QueryBuildError("batch_size должен быть положительным целым числом.")
    parameter_size = max(1, POSTGRES_PARAMETER_LIMIT // max(1, len(columns)))
    batch_size = min(requested_size, parameter_size)
    for start in range(0, len(query.rows), batch_size):
        batch = copy(query)
        batch.rows = query.rows[start : start + batch_size]
        yield batch


def _can_copy(query):
    return (
        query.operation == "bulk_insert"
        and not query.returning_fields
        and all(not isinstance(value, RawSQL) for row in query.rows for value in row.values())
    )


def _split_table(name):
    quote_ident(name)
    parts = str(name).split(".")
    if len(parts) == 1:
        return None, parts[0]
    if len(parts) == 2:
        return parts[0], parts[1]
    raise QueryBuildError(f"Неподдерживаемое имя таблицы: {name!r}.")


def _database_error(exc, *, sql, params):
    sqlstate = getattr(exc, "sqlstate", None)
    if sqlstate in TRANSIENT_SQLSTATES:
        return TransientTransactionError(str(exc), sqlstate=sqlstate, sql=sql, params=params)
    if sqlstate == UNIQUE_VIOLATION_SQLSTATE:
        return DuplicateKeyError(_duplicate_message(sql or "", exc), sql=sql, params=params)
    return QueryExecutionError(str(exc), sql=sql, params=params)


def _map_row(record, as_type=None, mapper=None):
    if record is None:
        return None
    if mapper is not None:
        row = record if isinstance(record, dict) else dict(record)
        return mapper(row)
    if as_type is not None:
        if is_model_class(as_type):
            return as_type.from_row(record)
        row = record if isinstance(record, dict) else dict(record)
        return as_type(**row)
    return record if isinstance(record, dict) else dict(record)


def _duplicate_message(sql, exc):
    message = str(exc).strip() or "Конфликт уникального ключа."
    table = re.search(r'INSERT INTO\s+"([^"]+)"', sql, re.IGNORECASE)
    key = re.search(r"Key \(([^)]+)\)=\(([^)]*)\)", message)
    if table and key and key.group(1) == "id":
        return (
            f"Невозможно вставить запись в {table.group(1)}: id={key.group(2)} уже занят. "
            "Не передавайте id вручную или используйте upsert()."
        )
    return message
