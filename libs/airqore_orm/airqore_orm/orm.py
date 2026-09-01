import asyncio
import random
from time import perf_counter

from .config import resolve_orm_config
from .exceptions import (
    ORMConfigurationError,
    QueryBuildError,
    TransactionError,
    TransientTransactionError,
)
from .models import get_model_meta, model_registry
from .query import Column, TableQuery
from .relations import RelationRegistry
from .schema.api import Schema
from .session import Session


class ORM:
    def __init__(self, config=None, *, event_hook=None):
        self._config_source = config
        self.config = resolve_orm_config(config) if config is not None else None
        self.pool = None
        self.event_hook = event_hook
        self.models = model_registry
        self.relations = RelationRegistry(self.models)
        self.schema = Schema(self)

    def bind_pool(self, pool, config=None):
        if config is not None or self.config is None:
            self.config = resolve_orm_config(config or self._config_source)
        self.pool = pool
        return self

    async def startup(self):
        if self.pool is None:
            import asyncpg

            if self.config is None:
                self.config = resolve_orm_config(self._config_source)
            self.pool = await asyncpg.create_pool(**self.config.to_asyncpg_kwargs())
        await self.schema.startup_check()
        return self.pool

    async def shutdown(self):
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    def session(self, connection=None):
        if connection is None and self.pool is None:
            raise ORMConfigurationError("ORM ещё не подключена к PostgreSQL.")
        return Session(
            pool=self.pool if connection is None else None,
            connection=connection,
            config=self.config,
            event_hook=self.event_hook,
        )

    def table(self, model_or_table, *, alias=None):
        return TableQuery(model_or_table, relations=self.relations, alias=alias, executor=self)

    def select(self, model, *, alias=None):
        return TableQuery(model, relations=self.relations, alias=alias, executor=self)

    async def get(self, model, **filters):
        return await self.select(model).where(**filters).first()

    async def find(self, model, **filters):
        return await self.select(model).where(**filters).all()

    async def exists(self, model, **filters):
        return await self.select(model).where(**filters).exists()

    def relate(self, source_table, target_table, **options):
        self.relations.register(source_table, target_table, **options)
        return self

    async def fetch_all(self, query, *args, **mapping):
        async with self.session() as session:
            return await session.fetch_all(query, *args, **mapping)

    async def fetch_one(self, query, *args, **mapping):
        async with self.session() as session:
            return await session.fetch_one(query, *args, **mapping)

    async def fetch_val(self, query, *args):
        async with self.session() as session:
            return await session.fetchval(query, *args)

    async def execute(self, query, *args):
        async with self.session() as session:
            return await session.execute(query, *args)

    def transaction(self, connection=None, **options):
        return ORMTransaction(self, connection=connection, options=options)

    async def run_transaction(self, operation, *, attempts=None, deadline=None, **options):
        attempts = self.config.transaction_attempts if attempts is None else attempts
        if attempts < 1:
            raise TransactionError("Число попыток транзакции должно быть не меньше одной.")
        started_at = perf_counter()
        for attempt in range(1, attempts + 1):
            try:
                # При deadlock повторяется вся операция, а не один случайный SQL.
                return await self._run_transaction_attempt(operation, deadline, started_at, options)
            except TransientTransactionError as error:
                if attempt == attempts:
                    raise
                delay = self._retry_delay(attempt)
                if deadline is not None and perf_counter() - started_at + delay >= deadline:
                    raise TransactionError("Истёк deadline повтора транзакции.") from error
                self._emit(
                    "db.retry", attempt=attempt, delay_ms=delay * 1000, sqlstate=error.sqlstate
                )
                await asyncio.sleep(delay)

    async def _run_transaction_attempt(self, operation, deadline, started_at, options):
        if deadline is None:
            async with self.transaction(**options) as session:
                return await operation(session)
        remaining = deadline - (perf_counter() - started_at)
        if remaining <= 0:
            raise TransactionError("Истёк deadline транзакции.")
        try:
            async with asyncio.timeout(remaining):
                async with self.transaction(**options) as session:
                    return await operation(session)
        except TimeoutError as exc:
            self._emit("db.transaction.timeout", deadline_ms=deadline * 1000)
            raise TransactionError("Истёк deadline транзакции.") from exc

    def _retry_delay(self, attempt):
        base = min(self.config.retry_max_delay, self.config.retry_base_delay * (2 ** (attempt - 1)))
        return base * random.uniform(0.5, 1.5)

    def _emit(self, event, **attributes):
        if self.event_hook is not None:
            self.event_hook(event, attributes)

    async def prefetch_many(self, parents, source, relation_name, **mapping):
        source_meta = get_model_meta(source)
        source_table = source_meta.qualified_table if source_meta else str(source)
        relation = self.relations.resolve(source_table, relation_name)
        if relation is None or relation.kind != "has_many":
            raise QueryBuildError(
                f"Связь {relation_name!r} не является to-many связью {source_table!r}."
            )
        if len(relation.source_columns) != 1 or len(relation.target_columns) != 1:
            raise QueryBuildError("prefetch_many пока поддерживает только одиночные ключи.")
        source_key = relation.source_columns[0]
        target_key = relation.target_columns[0]
        keys = {_row_value(parent, source_key, source_meta) for parent in parents}
        keys.discard(None)
        if not keys:
            return {}
        target_column = Column(None, target_key, target_key)
        query = self.table(relation.target_table).select("*").where(target_column.in_(keys))
        related_rows = await self.fetch_all(query, **mapping)
        grouped = {key: [] for key in keys}
        for row in related_rows:
            grouped.setdefault(_row_value(row, target_key), []).append(row)
        return grouped


def _row_value(row, column, model_meta=None):
    if isinstance(row, dict):
        return row.get(column)
    model_meta = model_meta or get_model_meta(type(row))
    if model_meta is None:
        return getattr(row, column, None)
    field = model_meta.get_field(column)
    name = field.name if field is not None else column
    return getattr(row, name, None)


class ORMTransaction:
    def __init__(self, orm, connection, options):
        self.orm = orm
        self.connection = connection
        self.options = options
        self.session = None
        self.transaction_scope = None

    async def __aenter__(self):
        self.session = self.orm.session(connection=self.connection)
        await self.session.__aenter__()
        try:
            self.transaction_scope = self.session.transaction(**self.options)
            return await self.transaction_scope.__aenter__()
        except BaseException:
            await self.session.close()
            raise

    async def __aexit__(self, exc_type, exc, traceback):
        try:
            return await self.transaction_scope.__aexit__(exc_type, exc, traceback)
        finally:
            await self.session.__aexit__(exc_type, exc, traceback)
