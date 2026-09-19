from quart import jsonify, request

from editor_client import EditorApiError, editor_client
from modules.auth.service import get_current_user


async def current_company():
    user = await get_current_user()
    return user if user and not user["disabled"] and user["category"] == "company" else None


def _cookie():
    return request.headers.get("Cookie", "")


def _error(error):
    return jsonify(error=error.code), error.status_code


async def list_for_user(_user_id):
    return await editor_client.list_kitchens(_cookie())


async def list_projects():
    if not await current_company():
        return jsonify(error="authentication_required"), 401
    try:
        return jsonify(projects=await editor_client.list_kitchens(_cookie()))
    except EditorApiError as error:
        return _error(error)


async def get_project(project_id):
    if not await current_company():
        return jsonify(error="authentication_required"), 401
    try:
        payload = await editor_client.get_kitchen(project_id, _cookie())
        kitchen = payload["kitchen"]
        return jsonify({
            "id": kitchen["id"], "name": kitchen["name"],
            "roomData": kitchen.get("roomData", {}), "sceneData": kitchen.get("sceneData", {}),
            "instances": payload.get("instances", []), "furniture": [],
        })
    except EditorApiError as error:
        return _error(error)


async def save_project(project_id=None):
    if not await current_company():
        return jsonify(error="authentication_required"), 401
    data = await request.get_json(silent=True) or {}
    try:
        payload = await (
            editor_client.update_kitchen(project_id, data, _cookie())
            if project_id else editor_client.create_kitchen(data, _cookie())
        )
        return jsonify(payload["kitchen"]), 200 if project_id else 201
    except EditorApiError as error:
        return _error(error)


async def delete_project(project_id):
    if not await current_company():
        return jsonify(error="authentication_required"), 401
    try:
        await editor_client.delete_kitchen(project_id, _cookie())
        return "", 204
    except EditorApiError as error:
        return _error(error)
