from quart import Blueprint

from . import service


controller = Blueprint("admin_profile", __name__)


@controller.get("/admin")
async def dashboard():
    return await service.dashboard()


@controller.patch("/api/admin/users/<int:user_id>")
async def update_user(user_id: int):
    return await service.update_user(user_id)
