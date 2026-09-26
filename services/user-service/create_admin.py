import argparse
import asyncio
import getpass
from passlib.context import CryptContext
from configuration import orm

''' Функциональность создания администратора
#? Требует подключения к основной логике
# '''

password_context = CryptContext(schemes=["bcrypt_sha256"], deprecated="auto")

async def create_admin(email: str, firstname: str, secondname: str, password: str):

    # Установка подключения к БД
    await orm.startup()
    try:
        password_hash = await asyncio.to_thread(password_context.hash, password)
        await orm.execute(
            """INSERT INTO users (email, password_hash, firstname, secondname, category)
               VALUES ($1, $2, $3, $4, 'admin')""",
            email.strip().lower(), password_hash, firstname.strip(), secondname.strip(),
        )
    finally:
        # Закрытие подключения к БД
        await orm.shutdown()
