"""Quart-сервис конструктора помещений."""

import asyncio
import json
import os
import socket
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from hypercorn.asyncio import serve
from hypercorn.config import Config
from quart import Quart, Response, jsonify, redirect, render_template, request


SERVICE_ROOT = Path(__file__).resolve().parent
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://127.0.0.1:8080").rstrip("/")
EDITOR_SERVICE_URL = os.getenv("EDITOR_SERVICE_URL", "http://127.0.0.1:8081").rstrip("/")
CONSTRUCTOR_HOST = os.getenv("CONSTRUCTOR_HOST", "127.0.0.1")
CONSTRUCTOR_PORT = int(os.getenv("CONSTRUCTOR_PORT", "8082"))


def _request(url: str, *, method: str = "GET", headers=None, body=None):
    outbound = Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urlopen(outbound, timeout=10) as response:
            return response.status, response.headers, response.read()
    except HTTPError as error:
        return error.code, error.headers, error.read()


async def _company_session(cookie_header: str) -> bool:
    try:
        status, _headers, body = await asyncio.to_thread(
            _request,
            f"{USER_SERVICE_URL}/api/auth/me",
            headers={"Cookie": cookie_header, "Accept": "application/json"},
        )
        payload = json.loads(body.decode("utf-8")) if body else {}
    except (URLError, TimeoutError, OSError, ValueError, UnicodeDecodeError):
        return False
    user = payload.get("user") if isinstance(payload, dict) else None
    return status == 200 and isinstance(user, dict) and user.get("category") == "company" and not user.get("disabled")


def create_app() -> Quart:
    app = Quart(
        "mebel-constructor",
        template_folder=str(SERVICE_ROOT / "templates"),
        static_folder=str(SERVICE_ROOT / "static"),
        static_url_path="/static",
    )

    @app.get("/constructor")
    async def constructor_redirect():
        return redirect("/constructor/")

    @app.get("/constructor/")
    async def constructor_page():
        if not await _company_session(request.headers.get("Cookie", "")):
            return_to = quote(request.url, safe="")
            return redirect(f"{USER_SERVICE_URL}/?auth=company&returnTo={return_to}")
        return await render_template("constructor.html")

    @app.route("/api/editor", defaults={"asset_path": ""}, methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    @app.route("/api/editor/<path:asset_path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def editor_api(asset_path: str):
        suffix = f"/{asset_path}" if asset_path else ""
        target = f"{EDITOR_SERVICE_URL}/api/editor{suffix}"
        if request.query_string:
            target = f"{target}?{request.query_string.decode('ascii')}"
        headers = {
            "Cookie": request.headers.get("Cookie", ""),
            "Accept": request.headers.get("Accept", "application/json"),
        }
        if request.content_type:
            headers["Content-Type"] = request.content_type
        try:
            status, upstream_headers, body = await asyncio.to_thread(
                _request,
                target,
                method=request.method,
                headers=headers,
                body=await request.get_data(),
            )
        except (URLError, TimeoutError, OSError):
            return jsonify({"error": "editor_service_unavailable"}), 503
        return Response(
            body,
            status=status,
            content_type=upstream_headers.get_content_type(),
        )

    return app


app = create_app()


def ensure_server_port_is_free() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        if probe.connect_ex((CONSTRUCTOR_HOST, CONSTRUCTOR_PORT)) == 0:
            raise RuntimeError(f"Порт {CONSTRUCTOR_PORT} уже занят. Остановите предыдущий constructor-service.")


async def main() -> None:
    ensure_server_port_is_free()
    config = Config()
    config.bind = [f"{CONSTRUCTOR_HOST}:{CONSTRUCTOR_PORT}"]
    config.loglevel = "WARNING"
    config.use_reloader = False
    await serve(app, config)


if __name__ == "__main__":
    asyncio.run(main())
