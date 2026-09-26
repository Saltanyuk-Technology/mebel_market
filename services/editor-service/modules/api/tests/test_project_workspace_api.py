import unittest
import uuid

from modules.api.auth.client import AuthenticatedCompany
from modules.api.database import editor_orm
from modules.api.schema import ensure_schema
from server import create_app
from modules.api.tests.test_definition_api import document


class FakeAuth:
    def __init__(self, user_id):
        self.user_id = user_id

    async def current_company(self, _cookie):
        return AuthenticatedCompany(self.user_id)


class ProjectWorkspaceApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await editor_orm.startup()
        await ensure_schema(editor_orm)
        self.user_id = 8_000_000 + uuid.uuid4().int % 900_000
        self.client = create_app(
            install_database=False,
            auth_client=FakeAuth(self.user_id),
        ).test_client()

    async def asyncTearDown(self):
        try:
            await editor_orm.execute(
                "DELETE FROM projects WHERE user_id IN ($1, $2)",
                self.user_id,
                self.user_id + 1,
            )
            await editor_orm.execute(
                "DELETE FROM furniture_definitions WHERE user_id IN ($1, $2)",
                self.user_id,
                self.user_id + 1,
            )
        except Exception:
            pass
        await editor_orm.shutdown()

    async def create_project(self, name="Дом Анны"):
        response = await self.client.post("/api/editor/projects", json={"name": name})
        self.assertEqual(response.status_code, 201)
        return (await response.get_json())["project"]

    async def create_room(self, project_id, name):
        response = await self.client.post(
            f"/api/editor/projects/{project_id}/rooms",
            json={"name": name},
        )
        self.assertEqual(response.status_code, 201)
        return (await response.get_json())["room"]

    async def create_furniture(self, project_id, name="Шкаф 600"):
        response = await self.client.post("/api/editor/definitions", json={
            "name": name,
            "projectId": project_id,
            "document": document(name),
        })
        self.assertEqual(response.status_code, 201)
        return await response.get_json()

    async def test_project_contains_multiple_independent_rooms(self):
        project = await self.create_project()
        first = await self.create_room(project["id"], "Кухня")
        second = await self.create_room(project["id"], "Гостиная")

        response = await self.client.get(f"/api/editor/projects/{project['id']}")
        payload = await response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual({room["id"] for room in payload["rooms"]}, {first["id"], second["id"]})
        self.assertEqual(payload["project"]["roomCount"], 2)

    async def test_furniture_is_shared_by_project_but_placements_are_per_room(self):
        project = await self.create_project()
        first = await self.create_room(project["id"], "Кухня")
        second = await self.create_room(project["id"], "Гостиная")
        furniture = await self.create_furniture(project["id"])
        definition = furniture["definition"]
        revision = furniture["revision"]

        first_placement = await self.client.post(
            f"/api/editor/rooms/{first['id']}/instances",
            json={
                "definitionId": definition["id"],
                "revisionId": revision["id"],
                "transform": {"positionMm": [100, 0, 200]},
            },
        )
        second_placement = await self.client.post(
            f"/api/editor/rooms/{second['id']}/instances",
            json={
                "definitionId": definition["id"],
                "revisionId": revision["id"],
                "transform": {"positionMm": [900, 0, 400]},
            },
        )

        self.assertEqual(first_placement.status_code, 201)
        self.assertEqual(second_placement.status_code, 201)
        first_payload = await (await self.client.get(f"/api/editor/rooms/{first['id']}")).get_json()
        second_payload = await (await self.client.get(f"/api/editor/rooms/{second['id']}")).get_json()
        self.assertEqual(first_payload["instances"][0]["transform"]["positionMm"], [100, 0, 200])
        self.assertEqual(second_payload["instances"][0]["transform"]["positionMm"], [900, 0, 400])

    async def test_library_snapshot_and_project_copy_are_independent(self):
        project = await self.create_project()
        furniture = await self.create_furniture(project["id"])
        definition = furniture["definition"]
        first_revision = furniture["revision"]

        saved = await self.client.post("/api/editor/library", json={
            "definitionId": definition["id"],
            "name": "Библиотечный шкаф",
        })
        self.assertEqual(saved.status_code, 201)
        item = (await saved.get_json())["item"]

        changed = document("Шкаф 800")
        changed["placement"]["boundsMm"]["width"] = 800
        changed_response = await self.client.post(
            f"/api/editor/definitions/{definition['id']}/revisions",
            json={"document": changed, "basedOnRevisionId": first_revision["id"]},
        )
        self.assertEqual(changed_response.status_code, 201)

        library = await (await self.client.get("/api/editor/library")).get_json()
        stored = next(entry for entry in library["items"] if entry["id"] == item["id"])
        self.assertEqual(stored["document"]["placement"]["boundsMm"]["width"], 600)

        copied_response = await self.client.post(
            f"/api/editor/library/{item['id']}/copy-to-project",
            json={"projectId": project["id"]},
        )
        self.assertEqual(copied_response.status_code, 201)
        copied = await copied_response.get_json()
        self.assertNotEqual(copied["definition"]["id"], item["definitionId"])
        self.assertEqual(copied["definition"]["projectId"], project["id"])
        self.assertEqual(copied["revision"]["document"]["placement"]["boundsMm"]["width"], 600)


if __name__ == "__main__":
    unittest.main()
