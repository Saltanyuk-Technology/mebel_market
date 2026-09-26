from quart import Blueprint, jsonify


controller = Blueprint("editor_health", __name__, url_prefix="/api/editor")


@controller.get("/health")
async def health():
    return jsonify(service="editor-api", status="ok")
