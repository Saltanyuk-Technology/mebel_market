from uuid import UUID

from quart import Blueprint

from . import service


controller = Blueprint("furniture_library", __name__, url_prefix="/api/furniture-library")


@controller.get("")
async def list_items():
    return await service.list_items()


@controller.post("")
async def create_item():
    return await service.create_item()


@controller.delete("/<uuid:item_id>")
async def delete_item(item_id: UUID):
    return await service.delete_item(item_id)
