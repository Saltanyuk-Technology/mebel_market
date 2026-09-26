from quart import Blueprint

from . import service


controller = Blueprint("auth", __name__, url_prefix="/api/auth")


@controller.post("/register")
async def register():
    return await service.register()


@controller.post("/login")
async def login():
    return await service.login()


@controller.post("/logout")
async def logout():
    return await service.logout()


@controller.get("/me")
async def me():
    return await service.me()
