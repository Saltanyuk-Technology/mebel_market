from quart import Blueprint

from . import service


controller = Blueprint("company_profile", __name__)


@controller.get("/company")
async def dashboard():
    return await service.dashboard()


@controller.get("/company/kitchen-projects/<uuid:project_id>")
async def kitchen_project(project_id):
    return await service.kitchen_project(project_id)
