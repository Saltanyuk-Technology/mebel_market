import json
import uuid

from quart import jsonify, request

from database import orm
from modules.auth.service import get_current_user
from .helpers import default_project_name, project_json


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS furniture_projects (
    id UUID PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    project_data JSONB NOT NULL,
    autosaved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS furniture_projects_user_updated_idx
    ON furniture_projects(user_id, updated_at DESC)
"""


async def ensure_schema() -> None:
    await orm.execute(CREATE_TABLE_SQL)


async def current_company():
    user = await get_current_user()
    return user if user and not user["disabled"] and user["category"] == "company" else None


async def list_for_user(user_id: int):
    return await orm.fetch_all(
        """SELECT id, name, autosaved, created_at, updated_at
           FROM furniture_projects WHERE user_id = $1 ORDER BY updated_at DESC""",
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
        """SELECT id, name, project_data, autosaved, created_at, updated_at
           FROM furniture_projects WHERE id = $1 AND user_id = $2""",
        project_id, int(user["id"]),
    )
    return jsonify(project_json(row, True)) if row else (jsonify({"error": "not_found"}), 404)


async def save_project(project_id=None, autosave: bool = False):
    user = await current_company()
    if not user:
        return jsonify({"error": "authentication_required"}), 401
    payload = await request.get_json(silent=True) or {}
    project_data = payload.get("data")
    if not isinstance(project_data, dict):
        return jsonify({"error": "invalid_project_data"}), 400
    name = str(payload.get("name") or default_project_name()).strip()[:160]
    requested_id = project_id or payload.get("projectId")
    if requested_id:
        try:
            requested_id = uuid.UUID(str(requested_id))
        except ValueError:
            return jsonify({"error": "invalid_project_id"}), 400
        row = await orm.fetch_one(
            """UPDATE furniture_projects
               SET name = $3, project_data = $4::jsonb, autosaved = $5, updated_at = NOW()
               WHERE id = $1 AND user_id = $2
               RETURNING id, name, project_data, autosaved, created_at, updated_at""",
            requested_id, int(user["id"]), name, json.dumps(project_data), autosave,
        )
        if row:
            return jsonify(project_json(row, True))
    new_id = uuid.uuid4()
    row = await orm.fetch_one(
        """INSERT INTO furniture_projects (id, user_id, name, project_data, autosaved)
           VALUES ($1, $2, $3, $4::jsonb, $5)
           RETURNING id, name, project_data, autosaved, created_at, updated_at""",
        new_id, int(user["id"]), name, json.dumps(project_data), autosave,
    )
    return jsonify(project_json(row, True)), 201


async def delete_project(project_id):
    user = await current_company()
    if not user:
        return jsonify({"error": "authentication_required"}), 401
    result = await orm.fetchval(
        "DELETE FROM furniture_projects WHERE id = $1 AND user_id = $2 RETURNING id",
        project_id, int(user["id"]),
    )
    return ("", 204) if result else (jsonify({"error": "not_found"}), 404)
