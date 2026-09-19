from airqore_orm import ORM

from .configuration import editor_database_config


editor_orm = ORM(config=editor_database_config())
