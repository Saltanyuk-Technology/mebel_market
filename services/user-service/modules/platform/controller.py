from quart import Blueprint

from . import service


controller = Blueprint("platform", __name__)


@controller.get("/")
async def index():
    return await service.index()


@controller.get("/health")
async def health():
    return await service.health()


@controller.get("/terms")
async def terms():
    return await service.terms()


@controller.after_app_request
async def disable_development_cache(response):
    return await service.disable_development_cache(response)
