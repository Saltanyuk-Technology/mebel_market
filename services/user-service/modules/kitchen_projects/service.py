import json
import uuid

from quart import jsonify, request

from database import orm
from modules.furniture_projects.helpers import project_json as furniture_json
from modules.furniture_projects.service import current_company


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS kitchen_projects (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    room_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    scene_data JSONB NOT NULL DEFAULT '{"placements": []}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS kitchen_projects_user_updated_idx
    ON kitchen_projects(user_id, updated_at DESC);
ALTER TABLE furniture_projects ADD COLUMN IF NOT EXISTS kitchen_project_id UUID;
CREATE INDEX IF NOT EXISTS furniture_projects_kitchen_project_idx
    ON furniture_projects(kitchen_project_id, updated_at DESC)
"""


async def ensure_schema() -> None:
    await orm.execute(CREATE_TABLE_SQL)
    await orm.execute("""
        DO $$ BEGIN
          ALTER TABLE furniture_projects
            ADD CONSTRAINT furniture_projects_kitchen_project_fk
            FOREIGN KEY (kitchen_project_id) REFERENCES kitchen_projects(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    """)


def project_json(row, include_data=False):
    result = {
        "id": str(row["id"]),
        "name": row["name"],
        "createdAt": row["created_at"].isoformat(),
        "updatedAt": row["updated_at"].isoformat(),
    }
    if "furniture_count" in row:
        result["furnitureCount"] = row["furniture_count"]
    if include_data:
        result["roomData"] = row["room_data"]
        result["sceneData"] = row["scene_data"]
    return result


async def list_for_user(user_id: int):
    return await orm.fetch_all(
        """SELECT kitchen.id, kitchen.name, kitchen.created_at, kitchen.updated_at,
                  COUNT(furniture.id) FILTER (WHERE furniture.autosaved = FALSE) AS furniture_count
           FROM kitchen_projects AS kitchen
           LEFT JOIN furniture_projects AS furniture ON furniture.kitchen_project_id = kitchen.id
           WHERE kitchen.user_id = $1
           GROUP BY kitchen.id ORDER BY kitchen.updated_at DESC""",
        user_id,
    )


async def list_projects():
    user = await current_company()
    if not user:
        return jsonify({"error": "authentication_required"}), 401
    rows = await list_for_user(int(user["id"]))
    return jsonify({"projects": [project_json(row) for row in rows]})


async def get_project(project_id):
    user = await current_company()
    if not user:
        return jsonify({"error": "authentication_required"}), 401
    row = await orm.fetch_one(
        """SELECT id, name, room_data, scene_data, created_at, updated_at
           FROM kitchen_projects WHERE id = $1 AND user_id = $2""",
        project_id, int(user["id"]),
    )
    if not row:
        return jsonify({"error": "not_found"}), 404
    furniture = await orm.fetch_all(
        """SELECT id, name, kitchen_project_id, project_data, autosaved, created_at, updated_at
           FROM furniture_projects
           WHERE kitchen_project_id = $1 AND user_id = $2 AND autosaved = FALSE
           ORDER BY updated_at DESC""",
        project_id, int(user["id"]),
    )
    result = project_json(row, True)
    result["furniture"] = [furniture_json(item, True) for item in furniture]
    return jsonify(result)


async def save_project(project_id=None):
    user = await current_company()
    if not user:
        return jsonify({"error": "authentication_required"}), 401
    payload = await request.get_json(silent=True) or {}
    name = str(payload.get("name") or "Новый проект кухни").strip()[:160] or "Новый проект кухни"
    room_data = payload.get("roomData") if isinstance(payload.get("roomData"), dict) else None
    scene_data = payload.get("sceneData") if isinstance(payload.get("sceneData"), dict) else None
    if project_id:
        row = await orm.fetch_one(
            """UPDATE kitchen_projects SET name = $3,
                   room_data = COALESCE($4::jsonb, room_data),
                   scene_data = COALESCE($5::jsonb, scene_data), updated_at = NOW()
               WHERE id = $1 AND user_id = $2
               RETURNING id, name, room_data, scene_data, created_at, updated_at""",
            project_id, int(user["id"]), name,
            json.dumps(room_data) if room_data is not None else None,
            json.dumps(scene_data) if scene_data is not None else None,
        )
        return jsonify(project_json(row, True)) if row else (jsonify({"error": "not_found"}), 404)
    row = await orm.fetch_one(
        """INSERT INTO kitchen_projects (id, user_id, name, room_data, scene_data)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
           RETURNING id, name, room_data, scene_data, created_at, updated_at""",
        uuid.uuid4(), int(user["id"]), name,
        json.dumps(room_data or {}), json.dumps(scene_data or {"placements": []}),
    )
    return jsonify(project_json(row, True)), 201


async def delete_project(project_id):
    user = await current_company()
    if not user:
        return jsonify({"error": "authentication_required"}), 401
    deleted = await orm.fetchval(
        "DELETE FROM kitchen_projects WHERE id = $1 AND user_id = $2 RETURNING id",
        project_id, int(user["id"]),
    )
    return ("", 204) if deleted else (jsonify({"error": "not_found"}), 404)
