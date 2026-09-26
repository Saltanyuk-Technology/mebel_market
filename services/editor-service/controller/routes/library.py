import json
import uuid

from quart import Blueprint, g, jsonify, request

from ..auth.decorators import require_company
from ..database import editor_orm
from ..helpers import camel_row


controller = Blueprint("editor-library", __name__)


@controller.get("/api/editor/library")
@require_company
async def list_library():
    rows = await editor_orm.fetch_all(
        """SELECT entry.*, definition.latest_revision_id, revision.document FROM furniture_library_entries AS entry
           JOIN furniture_definitions AS definition ON definition.id = entry.definition_id
           LEFT JOIN furniture_revisions AS revision ON revision.id = definition.latest_revision_id
           WHERE entry.user_id = $1 ORDER BY entry.updated_at DESC""", g.company.user_id,
    )
    return jsonify(items=[camel_row(row) for row in rows])


@controller.post("/api/editor/library")
@require_company
async def create_library_entry():
    payload = await request.get_json(silent=True) or {}
    try:
        definition_id = uuid.UUID(str(payload.get("definitionId")))
    except (ValueError, TypeError):
        return jsonify(error="invalid_definition_id"), 400
    row = await editor_orm.fetch_one(
        """INSERT INTO furniture_library_entries (id, user_id, definition_id, name)
           SELECT $1, $2, definition.id, $4 FROM furniture_definitions AS definition
           WHERE definition.id = $3 AND definition.user_id = $2 RETURNING *""",
        uuid.uuid4(), g.company.user_id, definition_id,
        str(payload.get("name") or "Новый элемент").strip()[:160] or "Новый элемент",
    )
    return (jsonify(item=camel_row(row)), 201) if row else (jsonify(error="not_found"), 404)


@controller.delete("/api/editor/library/<uuid:item_id>")
@require_company
async def delete_library_entry(item_id):
    deleted = await editor_orm.fetch_val(
        "DELETE FROM furniture_library_entries WHERE id = $1 AND user_id = $2 RETURNING id",
        item_id, g.company.user_id,
    )
    return ("", 204) if deleted else (jsonify(error="not_found"), 404)
