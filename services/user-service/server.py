import asyncio

from hypercorn.asyncio import serve
from quart import Quart

from airqore_orm.integrations.quart import install_orm
from configuration import configure_app, hypercorn_config
from database import orm
from helpers import ensure_server_port_is_free
from modules.admin_profile.controller import controller as admin_profile_controller
from modules.auth.controller import controller as auth_controller
from modules.company_profile.controller import controller as company_profile_controller
from modules.platform.controller import controller as platform_controller
from modules.user_profile.controller import controller as user_profile_controller
from modules.furniture_projects.controller import controller as furniture_projects_controller
from modules.furniture_projects.service import ensure_schema as ensure_furniture_projects_schema
from modules.furniture_library.controller import controller as furniture_library_controller
from modules.furniture_library.service import ensure_schema as ensure_furniture_library_schema
from modules.kitchen_projects.controller import controller as kitchen_projects_controller
from modules.kitchen_projects.service import ensure_schema as ensure_kitchen_projects_schema


def create_app() -> Quart:
    app = Quart(__name__)
    configure_app(app)
    install_orm(app, orm=orm)
    for controller in (
        platform_controller,
        auth_controller,
        user_profile_controller,
        company_profile_controller,
        admin_profile_controller,
        furniture_projects_controller,
        furniture_library_controller,
        kitchen_projects_controller,
    ):
        app.register_blueprint(controller)
    app.before_serving(ensure_furniture_projects_schema)
    app.before_serving(ensure_kitchen_projects_schema)
    app.before_serving(ensure_furniture_library_schema)
    return app


app = create_app()


async def main() -> None:
    ensure_server_port_is_free()
    await serve(app, hypercorn_config())


if __name__ == "__main__":
    asyncio.run(main())
