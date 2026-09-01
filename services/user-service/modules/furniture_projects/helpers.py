import json
from datetime import datetime


def default_project_name() -> str:
    return f"Проект {datetime.now().strftime('%d.%m.%Y %H:%M')}"


def project_json(row, include_data: bool = False) -> dict:
    result = {
        "id": str(row["id"]),
        "name": row["name"],
        "autosaved": row["autosaved"],
        "createdAt": row["created_at"].isoformat(),
        "updatedAt": row["updated_at"].isoformat(),
    }
    if include_data:
        data = row["project_data"]
        result["data"] = json.loads(data) if isinstance(data, str) else data
    return result
