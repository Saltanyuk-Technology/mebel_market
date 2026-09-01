from pathlib import Path

from airqore_orm import ORM, ORMConfig
from airqore_orm.config import load_dotenv


load_dotenv(Path(__file__).resolve().parents[2] / ".env")
orm = ORM(config=ORMConfig.from_env())
