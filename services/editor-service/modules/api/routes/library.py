import json
import uuid

from quart import Blueprint, g, jsonify, request

from ..auth.decorators import require_company
from ..database import editor_orm
from ..helpers import camel_row
from ..repositories.definitions import DefinitionRepository
from ..repositories.projects import ProjectRepository


controller = Blueprint("editor-library", __name__)


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


async def _snapshot_for_definition(user_id, definition_id):
    row = await editor_orm.fetch_one(
        """SELECT definition.*, revision.document, revision.placement_metadata
           FROM furniture_definitions AS definition
           JOIN furniture_revisions AS revision ON revision.id = definition.latest_revision_id
           WHERE definition.id = $1 AND definition.user_id = $2""",
        definition_id, user_id,
    )
    if not row:
        return None
    result = dict(row)
    result["document"] = _json(result["document"])
    result["placement_metadata"] = _json(result["placement_metadata"])
    return result


async def _clone_snapshot(user_id, snapshot, *, name, project_id=None):
    repository = DefinitionRepository(editor_orm)
    definition = await repository.create_definition(
        user_id,
        name=name,
        component_type=snapshot["component_type"],
        project_id=project_id,
    )
    revision = await repository.create_revision(
        user_id,
        definition["id"],
        document=snapshot["document"],
        placement_metadata=snapshot["placement_metadata"],
    )
    return definition, revision


@controller.get("/api/editor/library")
@require_company
async def list_library():
    rows = await editor_orm.fetch_all(
        """SELECT entry.*, definition.latest_revision_id, revision.document FROM furniture_library_entries AS entry
           JOIN furniture_definitions AS definition ON definition.id = entry.definition_id
           LEFT JOIN furniture_revisions AS revision ON revision.id = definition.latest_revision_id
           WHERE entry.user_id = $1 ORDER BY entry.updated_at DESC""", g.company.user_id,
    )
    items = []
    for row in rows:
        item = dict(row)
        item["document"] = _json(item.get("document"))
        items.append(camel_row(item))
    return jsonify(items=items)


@controller.post("/api/editor/library")
@require_company
async def create_library_entry():
    payload = await request.get_json(silent=True) or {}
    try:
        definition_id = uuid.UUID(str(payload.get("definitionId")))
    except (ValueError, TypeError):
        return jsonify(error="invalid_definition_id"), 400
    snapshot = await _snapshot_for_definition(g.company.user_id, definition_id)
    if not snapshot:
        return jsonify(error="not_found"), 404
    name = str(payload.get("name") or snapshot["name"] or "Новый элемент").strip()[:160] or "Новый элемент"
    definition, revision = await _clone_snapshot(
        g.company.user_id, snapshot, name=name
    )
    row = await editor_orm.fetch_one(
        """INSERT INTO furniture_library_entries (id, user_id, definition_id, name)
           VALUES ($1, $2, $3, $4) RETURNING *""",
        uuid.uuid4(), g.company.user_id, definition["id"], name,
    )
    item = dict(row)
    item["latest_revision_id"] = revision["id"]
    item["document"] = revision["document"]
    return jsonify(item=camel_row(item)), 201


@controller.post("/api/editor/library/<uuid:item_id>/copy-to-project")
@require_company
async def copy_library_entry_to_project(item_id):
    payload = await request.get_json(silent=True) or {}
    try:
        project_id = uuid.UUID(str(payload.get("projectId")))
    except (ValueError, TypeError):
        return jsonify(error="invalid_project_id"), 400
    if not await ProjectRepository(editor_orm).get(g.company.user_id, project_id):
        return jsonify(error="project_not_found"), 404
    item = await editor_orm.fetch_one(
        "SELECT * FROM furniture_library_entries WHERE id = $1 AND user_id = $2",
        item_id, g.company.user_id,
    )
    if not item:
        return jsonify(error="not_found"), 404
    snapshot = await _snapshot_for_definition(g.company.user_id, item["definition_id"])
    if not snapshot:
        return jsonify(error="not_found"), 404
    definition, revision = await _clone_snapshot(
        g.company.user_id, snapshot, name=item["name"], project_id=project_id
    )
    return jsonify(
        definition=camel_row(definition), revision=camel_row(revision)
    ), 201


@controller.delete("/api/editor/library/<uuid:item_id>")
@require_company
async def delete_library_entry(item_id):
    deleted = await editor_orm.fetch_val(
        "DELETE FROM furniture_library_entries WHERE id = $1 AND user_id = $2 RETURNING id",
        item_id, g.company.user_id,
    )
    return ("", 204) if deleted else (jsonify(error="not_found"), 404)
