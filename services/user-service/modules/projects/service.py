from quart import jsonify, request

from editor_client import EditorApiError, editor_client
from modules.auth.service import get_current_user


async def _company():
    user = await get_current_user()
    return user if user and not user["disabled"] and user["category"] == "company" else None


def _cookie():
    return request.headers.get("Cookie", "")


def _error(error):
    return jsonify(error=error.code), error.status_code


async def list_projects():
    if not await _company():
        return jsonify(error="authentication_required"), 401
    try:
        return jsonify(projects=await editor_client.list_projects(_cookie()))
    except EditorApiError as error:
        return _error(error)


async def save_project(project_id=None):
    if not await _company():
        return jsonify(error="authentication_required"), 401
    data = await request.get_json(silent=True) or {}
    try:
        payload = await (
            editor_client.update_project(project_id, data, _cookie())
            if project_id else editor_client.create_project(data, _cookie())
        )
        return jsonify(payload["project"]), 200 if project_id else 201
    except EditorApiError as error:
        return _error(error)


async def delete_project(project_id):
    if not await _company():
        return jsonify(error="authentication_required"), 401
    try:
        await editor_client.delete_project(project_id, _cookie())
        return "", 204
    except EditorApiError as error:
        return _error(error)


async def create_room(project_id):
    if not await _company():
        return jsonify(error="authentication_required"), 401
    data = await request.get_json(silent=True) or {}
    try:
        payload = await editor_client.create_room(project_id, data, _cookie())
        return jsonify(payload["room"]), 201
    except EditorApiError as error:
        return _error(error)


async def copy_library_item(project_id, item_id):
    if not await _company():
        return jsonify(error="authentication_required"), 401
    try:
        return jsonify(
            await editor_client.copy_library_to_project(item_id, project_id, _cookie())
        ), 201
    except EditorApiError as error:
        return _error(error)
