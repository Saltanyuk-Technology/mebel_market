import os
from pathlib import Path

from airqore_orm import ORMConfig
from airqore_orm.config import load_dotenv
from hypercorn.config import Config


ROOT = Path(__file__).resolve().parents[4]
load_dotenv(ROOT / ".env")


def editor_database_config() -> ORMConfig:
    return ORMConfig(
        host=os.getenv("EDITOR_DB_HOST", "127.0.0.1"),
        port=int(os.getenv("EDITOR_DB_PORT", "5432")),
        user=os.getenv("EDITOR_DB_USER", "postgres"),
        password=os.getenv("EDITOR_DB_PASSWORD", ""),
        database=os.getenv("EDITOR_DB_NAME", "mebel_editor"),
        min_size=int(os.getenv("EDITOR_DB_POOL_MIN", "1")),
        max_size=int(os.getenv("EDITOR_DB_POOL_MAX", "10")),
        connect_timeout=float(os.getenv("EDITOR_DB_CONNECT_TIMEOUT", "5")),
        application_name="mebel-editor-api",
    ).validate()


EDITOR_API_HOST = os.getenv("EDITOR_API_HOST", "127.0.0.1")
EDITOR_API_PORT = int(os.getenv("EDITOR_API_PORT", "8081"))
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8080").rstrip("/")


def hypercorn_config() -> Config:
    config = Config()
    config.bind = [f"{EDITOR_API_HOST}:{EDITOR_API_PORT}"]
    config.loglevel = "WARNING"
    config.use_reloader = False
    return config
