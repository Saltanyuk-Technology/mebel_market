#!/usr/bin/env python3
import asyncio
import argparse
import os
import sys

import asyncpg


# ---- БАЗОВЫЕ НАСТРОЙКИ КОННЕКТА ----
DB_HOST = "localhost"
DB_NAME = "mebel_market"
DB_USER = "postgres"
DB_PASSWORD = "ynrzc3iv-14"  # при необходимости поменяй


async def check_connection(host: str, db: str, user: str, password: str) -> None:
    """Проверка, что к БД можно подключиться."""
    conn = await asyncpg.connect(
        host=host,
        database=db,
        user=user,
        password=password,
    )
    await conn.close()


async def ensure_database_exists(
    host: str,
    db: str,
    user: str,
    password: str,
) -> None:
    """
    Проверяет существование БД. Если её нет — создаёт через подключение к postgres.
    Требуется суперюзер (kimmy).
    """
    try:
        await check_connection(host, db, user, password)
        return
    except asyncpg.InvalidCatalogNameError:
        # БД не существует
        pass

    # Подключаемся к postgres и создаём БД
    sys.stdout.write(f'БД "{db}" не существует, создаю...\n')
    sys.stdout.flush()

    conn = await asyncpg.connect(
        host=host,
        database="postgres",
        user=user,
        password=password,
    )
    # Экранируем имя БД и владельца
    db_quoted = db.replace('"', '""')
    user_quoted = user.replace('"', '""')
    await conn.execute(
        f'CREATE DATABASE "{db_quoted}" OWNER "{user_quoted}";'
    )
    await conn.close()

    sys.stdout.write(f'БД "{db}" создана.\n')
    sys.stdout.flush()


async def run_subprocess(cmd: list[str], env: dict | None = None) -> int:
    """Запускает внешний процесс (pg_dump / psql) и возвращает код возврата."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()

    if stdout:
        sys.stdout.buffer.write(stdout)
        sys.stdout.flush()
    if stderr:
        sys.stderr.buffer.write(stderr)
        sys.stderr.flush()

    return proc.returncode


async def dump_sql(
    host: str,
    db: str,
    user: str,
    password: str,
    sql_file: str,
    pg_dump_path: str = "pg_dump",
) -> None:
    """
    Делает plain-SQL дамп через pg_dump в файл sql_file.
    """
    sys.stdout.write(
        f'Делаю SQL дамп БД "{db}" в "{sql_file}" через {pg_dump_path}...\n'
    )
    sys.stdout.flush()

    env = os.environ.copy()
    env["PGPASSWORD"] = password

    cmd = [
        pg_dump_path,
        "-h", host,
        "-U", user,
        "-d", db,
        "-F", "p",       # plain SQL
        "-f", sql_file,
    ]

    rc = await run_subprocess(cmd, env=env)
    if rc != 0:
        raise SystemExit(
            f"pg_dump завершился с кодом {rc}. Дамп не создан или создан с ошибками."
        )

    sys.stdout.write("Дамп успешно создан.\n")
    sys.stdout.flush()


async def load_sql(
    host: str,
    db: str,
    user: str,
    password: str,
    sql_file: str,
    psql_path: str = "psql",
) -> None:
    """
    Создаёт БД при необходимости и накатывает sql_file через psql.
    """
    if not os.path.exists(sql_file):
        raise SystemExit(f'Файл "{sql_file}" не найден.')

    await ensure_database_exists(host, db, user, password)

    sys.stdout.write(
        f'Применяю "{sql_file}" к БД "{db}" через {psql_path}...\n'
    )
    sys.stdout.flush()

    env = os.environ.copy()
    env["PGPASSWORD"] = password

    cmd = [
        psql_path,
        "-h", host,
        "-U", user,
        "-d", db,
        "-f", sql_file,
    ]

    rc = await run_subprocess(cmd, env=env)
    if rc != 0:
        raise SystemExit(
            f"psql завершился с кодом {rc}. SQL не применён или применён с ошибками."
        )

    sys.stdout.write("SQL успешно применён.\n")
    sys.stdout.flush()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Утилита работы с SQL дампом Postgres (asyncpg + pg_dump/psql)."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--get_sql",
        action="store_true",
        help="Сделать SQL дамп и записать его в файл.",
    )
    group.add_argument(
        "--load_sql",
        action="store_true",
        help="Загрузить SQL из файла в БД.",
    )

    parser.add_argument(
        "--sql-file",
        default="base.sql",
        help='Путь к SQL файлу (по умолчанию "base.sql" в корне проекта).',
    )

    parser.add_argument(
        "--db-host",
        default=DB_HOST,
        help=f'Хост БД (по умолчанию "{DB_HOST}").',
    )
    parser.add_argument(
        "--db-name",
        default=DB_NAME,
        help=f'Имя БД (по умолчанию "{DB_NAME}").',
    )
    parser.add_argument(
        "--db-user",
        default=DB_USER,
        help=f'Пользователь БД (по умолчанию "{DB_USER}").',
    )
    parser.add_argument(
        "--db-password",
        default=DB_PASSWORD,
        help="Пароль пользователя БД (по умолчанию из конфига).",
    )

    parser.add_argument(
        "--pg-dump-path",
        default="pg_dump",
        help='Путь к pg_dump (если не в PATH, укажи полный путь).',
    )
    parser.add_argument(
        "--psql-path",
        default="psql",
        help='Путь к psql (если не в PATH, укажи полный путь).',
    )

    return parser.parse_args()


async def async_main() -> None:
    args = parse_args()

    host = args.db_host
    db = args.db_name
    user = args.db_user
    password = args.db_password
    sql_file = args.sql_file

    if args.get_sql:
        # локально, собираем дамп
        await dump_sql(
            host=host,
            db=db,
            user=user,
            password=password,
            sql_file=sql_file,
            pg_dump_path=args.pg_dump_path,
        )
    elif args.load_sql:
        # на сервере, создаём БД (если нужно) и накатываем дамп
        await load_sql(
            host=host,
            db=db,
            user=user,
            password=password,
            sql_file=sql_file,
            psql_path=args.psql_path,
        )
    else:
        raise SystemExit("Нужно указать либо --get_sql, либо --load_sql.")


def main() -> None:
    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        sys.stderr.write("Прервано пользователем.\n")
        sys.stderr.flush()


if __name__ == "__main__":
    main()