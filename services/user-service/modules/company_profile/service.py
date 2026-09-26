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
        projects = await editor_client.list_projects(_cookie())
    except EditorApiError:
        projects, unavailable = [], True
    return await render_template(
        TEMPLATE, user=user, projects=projects,
        editor_api_unavailable=unavailable,
    )


async def project_workspace(project_id):
    user = await get_current_user()
    if not user or user["disabled"] or user["category"] != ROLE:
        return redirect("/")
    try:
        payload, library = await asyncio.gather(
            editor_client.get_project(project_id, _cookie()),
            editor_client.list_library(_cookie()),
        )
    except EditorApiError:
        return redirect("/company")
    return await render_template(
        "project.html", user=user, project=payload["project"],
        rooms=payload.get("rooms", []), furniture=payload.get("furniture", []),
        library=library,
    )
