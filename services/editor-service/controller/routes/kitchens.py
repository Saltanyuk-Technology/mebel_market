import uuid

from quart import Blueprint, g, jsonify, request

from ..auth.decorators import require_company
from ..database import editor_orm
from ..helpers import camel_row
from ..repositories.kitchens import KitchenRepository
from ..services.placement import preview_update


controller = Blueprint("editor-kitchens", __name__)


@controller.get("/api/editor/kitchens")
@require_company
async def list_kitchens():
    rows = await KitchenRepository(editor_orm).list(g.company.user_id)
    return jsonify(kitchens=[camel_row(row) for row in rows])


@controller.post("/api/editor/kitchens")
@require_company
async def create_kitchen():
    payload = await request.get_json(silent=True) or {}
    row = await KitchenRepository(editor_orm).create(
        g.company.user_id, payload.get("name") or "Новый проект кухни",
        room_data=payload.get("roomData"), scene_data=payload.get("sceneData"),
    )
    return jsonify(kitchen=camel_row(row)), 201


@controller.get("/api/editor/kitchens/<uuid:project_id>")
@require_company
async def get_kitchen(project_id):
    repository = KitchenRepository(editor_orm)
    row = await repository.get(g.company.user_id, project_id)
    if not row:
        return jsonify(error="not_found"), 404
    instances = await repository.list_instances(g.company.user_id, project_id)
    return jsonify(kitchen=camel_row(row), instances=[camel_row(item) for item in instances])


@controller.put("/api/editor/kitchens/<uuid:project_id>")
@require_company
async def update_kitchen(project_id):
    payload = await request.get_json(silent=True) or {}
    current = await KitchenRepository(editor_orm).get(g.company.user_id, project_id)
    if not current:
        return jsonify(error="not_found"), 404
    row = await KitchenRepository(editor_orm).update(
        g.company.user_id, project_id, name=payload.get("name") or current["name"],
        room_data=payload.get("roomData"), scene_data=payload.get("sceneData"),
    )
    return jsonify(kitchen=camel_row(row))


@controller.delete("/api/editor/kitchens/<uuid:project_id>")
@require_company
async def delete_kitchen(project_id):
    deleted = await KitchenRepository(editor_orm).delete(g.company.user_id, project_id)
    return ("", 204) if deleted else (jsonify(error="not_found"), 404)


@controller.post("/api/editor/kitchens/<uuid:project_id>/instances")
@require_company
async def create_instance(project_id):
    payload = await request.get_json(silent=True) or {}
    try:
        row = await KitchenRepository(editor_orm).create_instance(
            g.company.user_id, project_id,
            uuid.UUID(str(payload.get("definitionId"))), uuid.UUID(str(payload.get("revisionId"))),
            transform=payload.get("transform") or {}, placement=payload.get("placement"),
        )
    except (TypeError, ValueError):
        row = None
    return (jsonify(instance=camel_row(row)), 201) if row else (jsonify(error="not_found"), 404)


@controller.put("/api/editor/kitchens/<uuid:project_id>/instances/<uuid:instance_id>")
@require_company
async def update_instance(project_id, instance_id):
    payload = await request.get_json(silent=True) or {}
    if not isinstance(payload.get("transform"), dict):
        return jsonify(error="invalid_transform"), 400
    row = await KitchenRepository(editor_orm).update_instance(
        g.company.user_id, project_id, instance_id,
        transform=payload["transform"], placement=payload.get("placement"),
    )
    return jsonify(instance=camel_row(row)) if row else (jsonify(error="not_found"), 404)


@controller.delete("/api/editor/kitchens/<uuid:project_id>/instances/<uuid:instance_id>")
@require_company
async def delete_instance(project_id, instance_id):
    deleted = await KitchenRepository(editor_orm).delete_instance(
        g.company.user_id, project_id, instance_id
    )
    return ("", 204) if deleted else (jsonify(error="not_found"), 404)


async def _revision_preview(project_id, instance_id, revision_id):
    try:
        revision_id = uuid.UUID(str(revision_id))
    except (TypeError, ValueError):
        return None
    context = await KitchenRepository(editor_orm).revision_update_context(
        g.company.user_id, project_id, instance_id, revision_id
    )
    if not context:
        return None
    instance, current, following, neighbors = context
    return preview_update(instance, current, following, neighbors, instance.get("room_data"))


@controller.post("/api/editor/kitchens/<uuid:project_id>/instances/<uuid:instance_id>/revision-preview")
@require_company
async def preview_instance_revision(project_id, instance_id):
    payload = await request.get_json(silent=True) or {}
    preview = await _revision_preview(project_id, instance_id, payload.get("revisionId"))
    return jsonify(preview=preview) if preview else (jsonify(error="not_found"), 404)


@controller.put("/api/editor/kitchens/<uuid:project_id>/instances/<uuid:instance_id>/revision")
@require_company
async def apply_instance_revision(project_id, instance_id):
    payload = await request.get_json(silent=True) or {}
    preview = await _revision_preview(project_id, instance_id, payload.get("revisionId"))
    if not preview:
        return jsonify(error="not_found"), 404
    if not preview["valid"]:
        return jsonify(error="placement_invalid", preview=preview), 409
    row = await KitchenRepository(editor_orm).apply_revision_update(
        g.company.user_id, project_id, instance_id, uuid.UUID(str(payload.get("revisionId"))), preview["nextTransform"]
    )
    return jsonify(instance=camel_row(row), preview=preview)
