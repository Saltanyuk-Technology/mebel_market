from uuid import UUID

from quart import Blueprint

from . import service


controller = Blueprint("projects", __name__, url_prefix="/api/projects")


@controller.get("")
async def list_projects():
    return await service.list_projects()


@controller.post("")
async def create_project():
    return await service.save_project()


@controller.put("/<uuid:project_id>")
async def update_project(project_id: UUID):
    return await service.save_project(project_id)


@controller.delete("/<uuid:project_id>")
async def delete_project(project_id: UUID):
    return await service.delete_project(project_id)


@controller.post("/<uuid:project_id>/rooms")
async def create_room(project_id: UUID):
    return await service.create_room(project_id)


@controller.post("/<uuid:project_id>/library/<uuid:item_id>/copy")
async def copy_library_item(project_id: UUID, item_id: UUID):
    return await service.copy_library_item(project_id, item_id)
