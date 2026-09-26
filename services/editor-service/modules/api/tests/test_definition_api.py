import unittest
import uuid

from modules.api.auth.client import AuthenticatedCompany
from modules.api.database import editor_orm
from modules.api.schema import ensure_schema
from server import create_app


class FakeAuth:
    def __init__(self, user_id):
        self.user_id = user_id

    async def current_company(self, _cookie):
        return AuthenticatedCompany(self.user_id)


def document(name="Шкаф"):
    root = str(uuid.uuid4())
    return {
        "schemaVersion": 2, "documentType": "furniture-definition", "rootAssemblyId": root,
        "metadata": {"name": name, "componentType": "cabinet", "units": "mm"},
        "entities": {"assemblies": [{"id": root, "parentAssemblyId": None}], "panels": [],
                     "facades": [], "hardwareInstances": [], "connections": [],
                     "machiningOperations": []},
        "placement": {"boundsMm": {"width": 600, "height": 720, "depth": 560}},
    }


class DefinitionApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await editor_orm.startup()
        await ensure_schema(editor_orm)
        self.user_id = 7_000_000 + uuid.uuid4().int % 900_000
        self.app = create_app(install_database=False, auth_client=FakeAuth(self.user_id))
        self.client = self.app.test_client()

    async def asyncTearDown(self):
        await editor_orm.execute("DELETE FROM furniture_definitions WHERE user_id IN ($1, $2)", self.user_id, self.user_id + 1)
        await editor_orm.shutdown()

    async def test_create_and_save_revision_keeps_first_revision_immutable(self):
        created_response = await self.client.post("/api/editor/definitions", json={
            "name": "Шкаф", "document": document(), "placementMetadata": {"widthMm": 600}
        })
        self.assertEqual(created_response.status_code, 201)
        created = await created_response.get_json()
        definition_id = created["definition"]["id"]
        first = created["revision"]

        second_response = await self.client.post(
            f"/api/editor/definitions/{definition_id}/revisions",
            json={"document": document("Шкаф 800"), "placementMetadata": {"widthMm": 800},
                  "basedOnRevisionId": first["id"]},
        )
        self.assertEqual(second_response.status_code, 201)
        second = (await second_response.get_json())["revision"]
        self.assertEqual(second["revisionNumber"], 2)

        first_response = await self.client.get(f"/api/editor/revisions/{first['id']}")
        restored_first = (await first_response.get_json())["revision"]
        self.assertEqual(restored_first["placementMetadata"]["widthMm"], 600)

        stale = await self.client.post(
            f"/api/editor/definitions/{definition_id}/revisions",
            json={"document": document(), "basedOnRevisionId": first["id"]},
        )
        self.assertEqual(stale.status_code, 409)

    async def test_other_owner_gets_not_found(self):
        response = await self.client.post("/api/editor/definitions", json={
            "name": "Частный", "document": document()
        })
        definition_id = (await response.get_json())["definition"]["id"]
        other = create_app(install_database=False, auth_client=FakeAuth(self.user_id + 1)).test_client()
        hidden = await other.get(f"/api/editor/definitions/{definition_id}")
        self.assertEqual(hidden.status_code, 404)

    async def test_invalid_multi_root_document_is_rejected(self):
        invalid = document()
        invalid["entities"]["assemblies"].append({"id": str(uuid.uuid4()), "parentAssemblyId": None})
        response = await self.client.post("/api/editor/definitions", json={"document": invalid})
        self.assertEqual(response.status_code, 422)

if __name__ == "__main__":
    unittest.main()
