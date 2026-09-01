from quart import jsonify, redirect, render_template

from database import orm
from modules.auth.service import get_current_user
from .helpers import dashboard_for


async def index():
    user = await get_current_user()
    if user and not user["disabled"]:
        return redirect(dashboard_for(user["category"]))
    return await render_template("index.html")


async def health():
    await orm.fetch_one("SELECT 1 AS ok")
    return jsonify(service="user", status="ok")


async def terms():
    return await render_template("terms.html")


async def disable_development_cache(response):
    response.headers.update({
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache", "Expires": "0",
    })
    return response
