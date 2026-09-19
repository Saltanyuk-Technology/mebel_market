from datetime import UTC, datetime
import uuid


def legacy_fixture(user_id):
    now = datetime.now(UTC)
    kitchen_id = uuid.uuid4()
    project_id = uuid.uuid4()
    library_id = uuid.uuid4()
    model = {
        "parts": [{
            "id": "part-1", "kind": "part", "name": "Дно", "partType": "bottom",
            "material": "ldsp-16", "sizeX": 600, "sizeY": 16, "sizeZ": 400,
            "xMm": 0, "yMm": 100, "zMm": 0,
            "rotationX": 0, "rotationY": 0, "rotationZ": 0,
        }],
        "connections": [], "nextPartNumber": 2, "nextConnectionNumber": 1, "gridStepMm": 1,
    }
    project_data = {"model": model, "selectedIds": ["part-1"]}
    return {
        "kitchens": [{
            "id": kitchen_id, "user_id": user_id, "name": "Кухня",
            "room_data": {"walls": []},
            "scene_data": {"placements": [{
                "id": str(uuid.uuid4()), "furnitureProjectId": str(project_id),
                "xMm": 100, "zMm": 200, "rotationY": 0,
            }]},
            "created_at": now, "updated_at": now,
        }],
        "projects": [{
            "id": project_id, "user_id": user_id, "name": "Шкаф 600",
            "kitchen_project_id": kitchen_id, "project_data": project_data,
            "autosaved": False, "created_at": now, "updated_at": now,
        }],
        "library": [{
            "id": library_id, "user_id": user_id, "source_project_id": project_id,
            "name": "Шаблон шкафа", "item_data": project_data,
            "created_at": now, "updated_at": now,
        }],
    }


class FixtureLegacySource:
    def __init__(self, fixture):
        self.fixture = fixture

    async def fetch_all(self, query, *args):
        if "FROM kitchen_projects" in query:
            return self.fixture["kitchens"]
        if "FROM furniture_projects" in query:
            return self.fixture["projects"]
        if "FROM furniture_library_items" in query:
            return self.fixture["library"]
        raise AssertionError(f"Unexpected source query: {query}")
