import hashlib
import json
import re
from types import SimpleNamespace

HISTORY_TABLE = "_airqore_schema_history"
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class AppliedSchemaState(SimpleNamespace):
    def __init__(self, fingerprint, plan_sql):
        super().__init__(fingerprint=fingerprint, plan_sql=plan_sql)


class MigrationHistoryStore:
    def __init__(self, table_name=HISTORY_TABLE):
        if not IDENTIFIER.fullmatch(table_name):
            raise ValueError(f"Небезопасное имя таблицы истории: {table_name!r}.")
        self.table_name = table_name

    async def ensure(self, session):
        lock_name = f"airqore:migration_history:{self.table_name}"
        await session.fetchval("SELECT pg_advisory_lock(hashtext($1))", lock_name)
        try:
            await session.execute(
                f"""
                CREATE TABLE IF NOT EXISTS "{self.table_name}" (
                    id BIGSERIAL PRIMARY KEY,
                    fingerprint TEXT NOT NULL,
                    plan_sql TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        finally:
            await session.fetchval("SELECT pg_advisory_unlock(hashtext($1))", lock_name)

    async def latest(self, session):
        exists = await session.fetchval("SELECT to_regclass($1)", self.table_name)
        if exists is None:
            return None
        row = await session.fetchrow(
            f'SELECT fingerprint, plan_sql FROM "{self.table_name}" ORDER BY id DESC LIMIT 1'
        )
        if row is None:
            return None
        return AppliedSchemaState(fingerprint=row["fingerprint"], plan_sql=row["plan_sql"])

    async def record(self, session, *, fingerprint, plan_sql):
        await self.ensure(session)
        await session.execute(
            f'INSERT INTO "{self.table_name}" (fingerprint, plan_sql) VALUES ($1, $2)',
            fingerprint,
            plan_sql,
        )

    @staticmethod
    def fingerprint_payload(payload):
        normalized = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
        return hashlib.sha256(normalized).hexdigest()
