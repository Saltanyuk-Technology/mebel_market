import unittest
import uuid

from api.auth.client import AuthenticatedCompany
from api.database import editor_orm
from api.schema import ensure_schema
from api.server import create_app
from api.repositories.definitions import DefinitionRepository
from api.repositories.kitchens import KitchenRepository
from api.tests.test_definition_api import document


class FakeAuth:
    def __init__(self, user_id):
        self.user_id = user_id

    async def current_company(self, _cookie):
        return AuthenticatedCompany(self.user_id)


class KitchenApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await editor_orm.startup()
        await ensure_schema(editor_orm)
        self.user_id = 6_000_000 + uuid.uuid4().int % 900_000
        self.app = create_app(install_database=False, auth_client=FakeAuth(self.user_id))
        self.client = self.app.test_client()

    async def asyncTearDown(self):
        await editor_orm.execute("DELETE FROM kitchen_projects WHERE user_id IN ($1, $2)", self.user_id, self.user_id + 1)
        await editor_orm.shutdown()

    async def test_create_list_and_owner_filter(self):
        created_response = await self.client.post("/api/editor/kitchens", json={
            "name": "Кухня", "roomData": {"walls": []}
        })
        self.assertEqual(created_response.status_code, 201)
        kitchen_id = (await created_response.get_json())["kitchen"]["id"]

        listing = await self.client.get("/api/editor/kitchens")
        self.assertEqual(len((await listing.get_json())["kitchens"]), 1)

        other = create_app(install_database=False, auth_client=FakeAuth(self.user_id + 1)).test_client()
        hidden = await other.get(f"/api/editor/kitchens/{kitchen_id}")
        self.assertEqual(hidden.status_code, 404)

    async def test_collision_preview_prevents_revision_update(self):
        kitchens = KitchenRepository(editor_orm)
        definitions = DefinitionRepository(editor_orm)
        kitchen = await kitchens.create(self.user_id, "Кухня")
        definition = await definitions.create_definition(self.user_id, name="Шкаф")
        old = await definitions.create_revision(
            self.user_id, definition["id"], document=document(),
            placement_metadata={"boundsMm": {"width": 400, "height": 720, "depth": 560}},
        )
        wider = document("Шкаф 800")
        wider["placement"]["boundsMm"]["width"] = 800
        new = await definitions.create_revision(
            self.user_id, definition["id"], document=wider,
            placement_metadata={"boundsMm": {"width": 800, "height": 720, "depth": 560}},
            based_on_revision_id=old["id"],
        )
        instance = await kitchens.create_instance(
            self.user_id, kitchen["id"], definition["id"], old["id"],
            transform={"positionMm": [0, 0, 0]}, placement={"anchor": "back-left-bottom"},
        )
        await kitchens.create_instance(
            self.user_id, kitchen["id"], definition["id"], old["id"],
            transform={"positionMm": [600, 0, 0]}, placement={"anchor": "back-left-bottom"},
        )

        preview = await self.client.post(
            f"/api/editor/kitchens/{kitchen['id']}/instances/{instance['id']}/revision-preview",
            json={"revisionId": str(new["id"])},
        )
        self.assertEqual(preview.status_code, 200)
        self.assertFalse((await preview.get_json())["preview"]["valid"])

        applied = await self.client.put(
            f"/api/editor/kitchens/{kitchen['id']}/instances/{instance['id']}/revision",
            json={"revisionId": str(new["id"])},
        )
        self.assertEqual(applied.status_code, 409)
        stored = await editor_orm.fetch_one("SELECT revision_id FROM furniture_instances WHERE id = $1", instance["id"])
        self.assertEqual(stored["revision_id"], old["id"])


if __name__ == "__main__":
    unittest.main()
