from quart import Blueprint, g, jsonify, request

from ..auth.decorators import require_company
from ..database import editor_orm
from ..helpers import camel_row
from ..repositories.definitions import DefinitionRepository
from ..repositories.projects import ProjectRepository
from ..repositories.rooms import RoomRepository


controller = Blueprint("editor-projects", __name__)


@controller.get("/api/editor/projects")
@require_company
async def list_projects():
    rows = await ProjectRepository(editor_orm).list(g.company.user_id)
    return jsonify(projects=[camel_row(row) for row in rows])


@controller.post("/api/editor/projects")
@require_company
async def create_project():
    payload = await request.get_json(silent=True) or {}
    row = await ProjectRepository(editor_orm).create(
        g.company.user_id, payload.get("name") or "Новый проект"
    )
    return jsonify(project=camel_row(row)), 201


@controller.get("/api/editor/projects/<uuid:project_id>")
@require_company
async def get_project(project_id):
    project = await ProjectRepository(editor_orm).get(g.company.user_id, project_id)
    if not project:
        return jsonify(error="not_found"), 404
    rooms = await RoomRepository(editor_orm).list(g.company.user_id, project_id)
    furniture = await DefinitionRepository(editor_orm).list_definitions(
        g.company.user_id, project_id=project_id
    )
    return jsonify(
        project=camel_row(project),
        rooms=[camel_row(room) for room in rooms],
        furniture=[camel_row(item) for item in furniture],
    )


@controller.put("/api/editor/projects/<uuid:project_id>")
@require_company
async def update_project(project_id):
    payload = await request.get_json(silent=True) or {}
    current = await ProjectRepository(editor_orm).get(g.company.user_id, project_id)
    if not current:
        return jsonify(error="not_found"), 404
    row = await ProjectRepository(editor_orm).update(
        g.company.user_id, project_id, payload.get("name") or current["name"]
    )
    return jsonify(project=camel_row(row))


@controller.delete("/api/editor/projects/<uuid:project_id>")
@require_company
async def delete_project(project_id):
    deleted = await ProjectRepository(editor_orm).delete(g.company.user_id, project_id)
    return ("", 204) if deleted else (jsonify(error="not_found"), 404)


@controller.post("/api/editor/projects/<uuid:project_id>/rooms")
@require_company
async def create_room(project_id):
    payload = await request.get_json(silent=True) or {}
    row = await RoomRepository(editor_orm).create(
        g.company.user_id, project_id, payload.get("name") or "Новое помещение",
        room_data=payload.get("roomData"), scene_data=payload.get("sceneData"),
    )
    return (jsonify(room=camel_row(row)), 201) if row else (jsonify(error="not_found"), 404)
