from airqore_orm import ORM, ORMConfig


orm = ORM(config=ORMConfig.from_env())
db = orm.access()
