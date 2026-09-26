from quart import Blueprint

from . import service


controller = Blueprint("company_profile", __name__)


@controller.get("/company")
async def dashboard():
    return await service.dashboard()


@controller.get("/company/projects/<uuid:project_id>")
async def project_workspace(project_id):
    return await service.project_workspace(project_id)
