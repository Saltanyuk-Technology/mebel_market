from quart import Blueprint

from . import service


controller = Blueprint("user_profile", __name__)


@controller.get("/user")
async def dashboard():
    return await service.dashboard()
