"""Quart-сервис редактора мебели и его API."""

import asyncio
from pathlib import Path
from urllib.parse import quote

from airqore_orm.integrations.quart import install_orm
from hypercorn.asyncio import serve
from quart import Quart, current_app, redirect, render_template, request

from modules.api.auth.client import AuthClient, AuthError
from modules.api.configuration import USER_SERVICE_URL, hypercorn_config
from modules.api.database import editor_orm
from modules.api.helpers import ensure_server_port_is_free
from modules.api.routes.catalog import controller as catalog_controller
from modules.api.routes.definitions import controller as definitions_controller
from modules.api.routes.health import controller as health_controller
from modules.api.routes.library import controller as library_controller
from modules.api.routes.projects import controller as projects_controller
from modules.api.routes.rooms import controller as rooms_controller


SERVICE_ROOT = Path(__file__).resolve().parent


def create_app(*, install_database: bool = True, auth_client=None) -> Quart:
    app = Quart(
        "mebel-editor",
        template_folder=str(SERVICE_ROOT / "templates"),
        static_folder=str(SERVICE_ROOT / "static"),
        static_url_path="/static",
    )
    app.extensions["editor_auth_client"] = auth_client or AuthClient()

    if install_database:
        install_orm(app, orm=editor_orm)

    for controller in (
        health_controller,
        definitions_controller,
        projects_controller,
        rooms_controller,
        library_controller,
        catalog_controller,
    ):
        app.register_blueprint(controller)

    @app.get("/editor")
    async def editor_redirect():
        return redirect("/editor/")

    @app.get("/editor/")
    async def editor_page():
        auth = current_app.extensions["editor_auth_client"]
        try:
            await auth.current_company(request.headers.get("Cookie", ""))
        except AuthError:
            return_to = quote(request.url, safe="")
            return redirect(f"{USER_SERVICE_URL}/?auth=company&returnTo={return_to}")
        return await render_template("editor.html")

    return app


app = create_app()


async def main() -> None:
    ensure_server_port_is_free()
    await serve(app, hypercorn_config())


if __name__ == "__main__":
    asyncio.run(main())
