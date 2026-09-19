from pathlib import Path


SCHEMA_SQL = (Path(__file__).resolve().parents[1] / "sql" / "001_editor_schema.sql").read_text(
    encoding="utf-8"
)


async def ensure_schema(orm) -> None:
    await orm.execute(SCHEMA_SQL)
