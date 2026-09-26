import uuid

from quart import Blueprint, g, jsonify, request

from ..auth.decorators import require_company
from ..database import editor_orm
from ..helpers import camel_row
from ..repositories.rooms import RoomRepository


controller = Blueprint("editor-rooms", __name__)


@controller.get("/api/editor/rooms/<uuid:room_id>")
@require_company
async def get_room(room_id):
    repository = RoomRepository(editor_orm)
    room = await repository.get(g.company.user_id, room_id)
    if not room:
        return jsonify(error="not_found"), 404
    instances = await repository.list_instances(g.company.user_id, room_id)
    return jsonify(room=camel_row(room), instances=[camel_row(item) for item in instances])


@controller.put("/api/editor/rooms/<uuid:room_id>")
@require_company
async def update_room(room_id):
    payload = await request.get_json(silent=True) or {}
    repository = RoomRepository(editor_orm)
    current = await repository.get(g.company.user_id, room_id)
    if not current:
        return jsonify(error="not_found"), 404
    row = await repository.update(
        g.company.user_id, room_id, name=payload.get("name") or current["name"],
        room_data=payload.get("roomData"), scene_data=payload.get("sceneData"),
    )
    return jsonify(room=camel_row(row))


@controller.delete("/api/editor/rooms/<uuid:room_id>")
@require_company
async def delete_room(room_id):
    deleted = await RoomRepository(editor_orm).delete(g.company.user_id, room_id)
    return ("", 204) if deleted else (jsonify(error="not_found"), 404)


@controller.post("/api/editor/rooms/<uuid:room_id>/instances")
@require_company
async def create_instance(room_id):
    payload = await request.get_json(silent=True) or {}
    try:
        row = await RoomRepository(editor_orm).create_instance(
            g.company.user_id, room_id,
            uuid.UUID(str(payload.get("definitionId"))),
            uuid.UUID(str(payload.get("revisionId"))),
            transform=payload.get("transform") or {}, placement=payload.get("placement"),
        )
    except (TypeError, ValueError):
        row = None
    return (jsonify(instance=camel_row(row)), 201) if row else (jsonify(error="not_found"), 404)


@controller.put("/api/editor/rooms/<uuid:room_id>/instances/<uuid:instance_id>")
@require_company
async def update_instance(room_id, instance_id):
    payload = await request.get_json(silent=True) or {}
    if not isinstance(payload.get("transform"), dict):
        return jsonify(error="invalid_transform"), 400
    row = await RoomRepository(editor_orm).update_instance(
        g.company.user_id, room_id, instance_id,
        transform=payload["transform"], placement=payload.get("placement"),
    )
    return jsonify(instance=camel_row(row)) if row else (jsonify(error="not_found"), 404)


@controller.delete("/api/editor/rooms/<uuid:room_id>/instances/<uuid:instance_id>")
@require_company
async def delete_instance(room_id, instance_id):
    deleted = await RoomRepository(editor_orm).delete_instance(
        g.company.user_id, room_id, instance_id
    )
    return ("", 204) if deleted else (jsonify(error="not_found"), 404)
