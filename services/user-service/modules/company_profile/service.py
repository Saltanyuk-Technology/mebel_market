import asyncio

from quart import redirect, render_template, request

from editor_client import EditorApiError, editor_client
from modules.auth.service import get_current_user
from .helpers import ROLE, TEMPLATE


def _cookie():
    return request.headers.get("Cookie", "")


async def dashboard():
    user = await get_current_user()
    if not user or user["disabled"] or user["category"] != ROLE:
        return redirect("/")
    unavailable = False
    try:
        kitchen_projects, projects = await asyncio.gather(
            editor_client.list_kitchens(_cookie()),
            editor_client.list_definitions(_cookie()),
        )
        projects = [item for item in projects if not item.get("autosaved")]
        counts = {}
        for item in projects:
            if item.get("kitchenProjectId"):
                counts[item["kitchenProjectId"]] = counts.get(item["kitchenProjectId"], 0) + 1
        for kitchen in kitchen_projects:
            kitchen["furniture_count"] = counts.get(kitchen["id"], 0)
    except EditorApiError:
        kitchen_projects, projects, unavailable = [], [], True
    return await render_template(
        TEMPLATE, user=user, projects=projects, kitchen_projects=kitchen_projects,
        editor_api_unavailable=unavailable,
    )


async def kitchen_project(project_id):
    user = await get_current_user()
    if not user or user["disabled"] or user["category"] != ROLE:
        return redirect("/")
    try:
        payload, furniture = await asyncio.gather(
            editor_client.get_kitchen(project_id, _cookie()),
            editor_client.list_definitions(_cookie(), project_id),
        )
    except EditorApiError:
        return redirect("/company")
    project = payload["kitchen"]
    furniture = [item for item in furniture if not item.get("autosaved")]
    room_ready = bool((project.get("roomData") or {}).get("walls"))
    placements_count = len(payload.get("instances") or [])
    return await render_template(
        "kitchen_project.html", user=user, project=project, furniture=furniture,
        room_ready=room_ready, placements_count=placements_count,
    )
