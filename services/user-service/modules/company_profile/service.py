from quart import redirect, render_template

from modules.auth.service import get_current_user
from modules.furniture_projects.service import list_for_user
from .helpers import ROLE, TEMPLATE


async def dashboard():
    user = await get_current_user()
    if not user or user["disabled"] or user["category"] != ROLE:
        return redirect("/")
    projects = await list_for_user(int(user["id"]))
    return await render_template(TEMPLATE, user=user, projects=projects)
