import asyncio

from airqore_orm.integrations.quart import install_orm
from hypercorn.asyncio import serve
from quart import Quart

from .auth.client import AuthClient
from .configuration import hypercorn_config
from .database import editor_orm
from .helpers import ensure_server_port_is_free
from .routes.health import controller as health_controller
from .routes.definitions import controller as definitions_controller
from .routes.kitchens import controller as kitchens_controller
from .routes.library import controller as library_controller
from .routes.catalog import controller as catalog_controller
from .schema import ensure_schema


def create_app(*, install_database: bool = True, auth_client=None) -> Quart:
    app = Quart("mebel-editor-api")
    app.extensions["editor_auth_client"] = auth_client or AuthClient()
    if install_database:
        install_orm(app, orm=editor_orm)

        async def prepare_editor_schema():
            await ensure_schema(editor_orm)

        app.before_serving(prepare_editor_schema)
    app.register_blueprint(health_controller)
    app.register_blueprint(definitions_controller)
    app.register_blueprint(kitchens_controller)
    app.register_blueprint(library_controller)
    app.register_blueprint(catalog_controller)
    return app


app = create_app()


async def main() -> None:
    ensure_server_port_is_free()
    await serve(app, hypercorn_config())


if __name__ == "__main__":
    asyncio.run(main())
