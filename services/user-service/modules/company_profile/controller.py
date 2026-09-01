from quart import Blueprint

from . import service


controller = Blueprint("company_profile", __name__)


@controller.get("/company")
async def dashboard():
    return await service.dashboard()
