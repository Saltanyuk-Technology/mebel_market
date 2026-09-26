import os
from pathlib import Path

from airqore_orm import ORM, ORMConfig
from airqore_orm.config import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
orm = ORM(config=ORMConfig.from_env())

HOST = os.getenv("SERVER_HOST", "127.0.0.1")
PORT = int(os.getenv("SERVER_PORT", "8080"))
SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "development-secret")
COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true"
SESSION_MAX_AGE = 14 * 24 * 60 * 60
