from airqore_orm import ORM, ORMConfig
from airqore_orm.config import load_dotenv

''' Файл конфигурации Базы Данных и подключений'''

load_dotenv(".env")
orm = ORM(config=ORMConfig.from_env())

import os

HOST = os.getenv('SERVER_HOST')
PORT = int(os.getenv('SERVER_PORT'))
SECRET_KEY = os.getenv("AUTH_SECRET_KEY")
COOKIE_SECURE = 'false'
SESSION_MAX_AGE = 14 * 24 * 60 * 60





