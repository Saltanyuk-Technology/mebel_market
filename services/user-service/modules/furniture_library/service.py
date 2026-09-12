import json
import uuid

from quart import jsonify, request

from database import orm
from modules.furniture_projects.service import current_company


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS furniture_library_items (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_project_id UUID REFERENCES furniture_projects(id) ON DELETE SET NULL,
    name VARCHAR(160) NOT NULL,
    item_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS furniture_library_user_updated_idx
    ON furniture_library_items(user_id, updated_at DESC)
"""


async def ensure_schema() -> None:
    await orm.execute(CREATE_TABLE_SQL)


def item_json(row):
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "sourceProjectId": str(row["source_project_id"]) if row["source_project_id"] else None,
        "data": row["item_data"],
        "createdAt": row["created_at"].isoformat(),
        "updatedAt": row["updated_at"].isoformat(),
    }


async def list_items():
    user = await current_company()
    if not user:
        return jsonify({"error": "authentication_required"}), 401
    rows = await orm.fetch_all(
        """SELECT id, source_project_id, name, item_data, created_at, updated_at
           FROM furniture_library_items WHERE user_id = $1 ORDER BY updated_at DESC""",
        int(user["id"]),
    )
    return jsonify({"items": [item_json(row) for row in rows]})


async def create_item():
    user = await current_company()
    if not user:
        return jsonify({"error": "authentication_required"}), 401
    payload = await request.get_json(silent=True) or {}
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("model"), dict):
        return jsonify({"error": "invalid_item_data"}), 400
    if not data["model"].get("parts"):
        return jsonify({"error": "empty_model"}), 400
    name = str(payload.get("name") or "Новый шаблон").strip()[:160] or "Новый шаблон"
    source_project_id = payload.get("sourceProjectId")
    if source_project_id:
        try:
            source_project_id = uuid.UUID(str(source_project_id))
        except ValueError:
            return jsonify({"error": "invalid_source_project_id"}), 400
        owns_source = await orm.fetchval(
            "SELECT id FROM furniture_projects WHERE id = $1 AND user_id = $2",
            source_project_id, int(user["id"]),
        )
        if not owns_source:
            return jsonify({"error": "source_project_not_found"}), 404
    row = await orm.fetch_one(
        """INSERT INTO furniture_library_items (id, user_id, source_project_id, name, item_data)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           RETURNING id, source_project_id, name, item_data, created_at, updated_at""",
        uuid.uuid4(), int(user["id"]), source_project_id, name, json.dumps(data),
    )
    return jsonify(item_json(row)), 201


async def delete_item(item_id):
    user = await current_company()
    if not user:
        return jsonify({"error": "authentication_required"}), 401
    deleted = await orm.fetchval(
        "DELETE FROM furniture_library_items WHERE id = $1 AND user_id = $2 RETURNING id",
        item_id, int(user["id"]),
    )
    return ("", 204) if deleted else (jsonify({"error": "not_found"}), 404)
