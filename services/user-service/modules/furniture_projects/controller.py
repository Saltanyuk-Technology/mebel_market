from uuid import UUID

from quart import Blueprint

from . import service


controller = Blueprint("furniture_projects", __name__, url_prefix="/api/furniture-projects")


@controller.get("")
async def list_projects():
    return await service.list_projects()


@controller.get("/<uuid:project_id>")
async def get_project(project_id: UUID):
    return await service.get_project(project_id)


@controller.post("")
async def create_project():
    return await service.save_project()


@controller.put("/<uuid:project_id>")
async def update_project(project_id: UUID):
    return await service.save_project(project_id)


@controller.post("/autosave")
async def autosave_project():
    return await service.save_project(autosave=True)


@controller.delete("/<uuid:project_id>")
async def delete_project(project_id: UUID):
    return await service.delete_project(project_id)
