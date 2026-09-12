from quart import redirect, render_template

from database import orm
from modules.auth.service import get_current_user
from modules.furniture_projects.service import list_for_user
from modules.kitchen_projects.service import list_for_user as list_kitchen_projects
from .helpers import ROLE, TEMPLATE


async def dashboard():
    user = await get_current_user()
    if not user or user["disabled"] or user["category"] != ROLE:
        return redirect("/")
    projects = await list_for_user(int(user["id"]))
    kitchen_projects = await list_kitchen_projects(int(user["id"]))
    return await render_template(TEMPLATE, user=user, projects=projects, kitchen_projects=kitchen_projects)


async def kitchen_project(project_id):
    user = await get_current_user()
    if not user or user["disabled"] or user["category"] != ROLE:
        return redirect("/")
    project = await orm.fetch_one(
        """SELECT id, name, room_data, scene_data, created_at, updated_at
           FROM kitchen_projects WHERE id = $1 AND user_id = $2""",
        project_id, int(user["id"]),
    )
    if not project:
        return redirect("/company")
    furniture = await orm.fetch_all(
        """SELECT id, name, project_data, updated_at
           FROM furniture_projects
           WHERE kitchen_project_id = $1 AND user_id = $2 AND autosaved = FALSE
           ORDER BY updated_at DESC""",
        project_id, int(user["id"]),
    )
    room_data = project["room_data"] or {}
    scene_data = project["scene_data"] or {}
    room_ready = bool(room_data.get("walls"))
    placements_count = len(scene_data.get("placements") or [])
    return await render_template(
        "kitchen_project.html",
        user=user,
        project=project,
        furniture=furniture,
        room_ready=room_ready,
        placements_count=placements_count,
    )
