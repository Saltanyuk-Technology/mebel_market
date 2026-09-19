import socket
from datetime import date, datetime
import uuid

from .configuration import EDITOR_API_HOST, EDITOR_API_PORT


def ensure_server_port_is_free() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        if probe.connect_ex((EDITOR_API_HOST, EDITOR_API_PORT)) == 0:
            raise RuntimeError(
                f"Порт {EDITOR_API_PORT} уже занят. Остановите предыдущий editor-api."
            )


def json_value(value):
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def camel_row(row):
    aliases = {
        "revision_number": "revisionNumber", "based_on_revision_id": "basedOnRevisionId",
        "schema_version": "schemaVersion", "placement_metadata": "placementMetadata",
        "latest_revision_id": "latestRevisionId", "component_type": "componentType",
        "kitchen_project_id": "kitchenProjectId", "definition_id": "definitionId",
        "revision_id": "revisionId", "room_data": "roomData", "scene_data": "sceneData",
        "created_at": "createdAt", "updated_at": "updatedAt",
    }
    return {aliases.get(key, key): json_value(value) for key, value in dict(row).items()}
