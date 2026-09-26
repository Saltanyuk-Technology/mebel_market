from ..config import resolve_orm_config
from ..orm import ORM


def install_orm(app, config=None, orm=None):
    instance = orm or ORM()
    config_source = config or app.config.get("DB_CONFIG") or instance._config_source
    instance.config = resolve_orm_config(config_source)
    app.extensions = getattr(app, "extensions", {})
    app.extensions["airqore_orm"] = instance
    app.orm = instance

    async def startup():
        await instance.startup()

    async def shutdown():
        await instance.shutdown()

    app.before_serving(startup)
    app.after_serving(shutdown)
    return instance
