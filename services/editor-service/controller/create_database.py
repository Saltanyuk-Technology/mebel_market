import asyncio
import re

import asyncpg

from .configuration import editor_database_config


async def ensure_database() -> bool:
    config = editor_database_config()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", config.database):
        raise ValueError("invalid_editor_database_name")
    connection = await asyncpg.connect(
        host=config.host,
        port=config.port,
        user=config.user,
        password=config.password,
        database="postgres",
        timeout=config.connect_timeout,
    )
    try:
        exists = await connection.fetchval(
            "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)", config.database
        )
        if exists:
            return False
        await connection.execute(f'CREATE DATABASE "{config.database}"')
        return True
    finally:
        await connection.close()


if __name__ == "__main__":
    created = asyncio.run(ensure_database())
    print("created" if created else "already exists")
