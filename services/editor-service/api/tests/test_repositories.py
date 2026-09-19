import unittest
import uuid

from api.database import editor_orm
from api.repositories.definitions import DefinitionRepository, RevisionConflict
from api.repositories.catalog import CatalogRepository
from api.schema import ensure_schema


class DefinitionRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await editor_orm.startup()
        await ensure_schema(editor_orm)
        self.user_id = 9_000_000 + uuid.uuid4().int % 900_000
        self.other_user_id = self.user_id + 1
        self.repository = DefinitionRepository(editor_orm)

    async def asyncTearDown(self):
        await editor_orm.execute("DELETE FROM furniture_definitions WHERE user_id IN ($1, $2)", self.user_id, self.other_user_id)
        await editor_orm.shutdown()

    async def test_catalog_product_versions_are_retained(self):
        catalog = CatalogRepository(editor_orm)
        suffix = uuid.uuid4().hex
        manufacturer = await catalog.create_manufacturer(f"maker-{suffix}", "Производитель")
        product = await catalog.create_product(manufacturer["id"], f"item-{suffix}", "hinge", "Петля")
        first = await catalog.create_product_version(product["id"], {"angle": 100})
        second = await catalog.create_product_version(product["id"], {"angle": 110})
        versions = await catalog.list_product_versions(product["id"])
        self.assertEqual(first["version_number"], 1)
        self.assertEqual(second["version_number"], 2)
        self.assertEqual([row["data"]["angle"] for row in versions], [100, 110])

    async def test_revision_is_immutable_and_numbered_per_definition(self):
        definition = await self.repository.create_definition(
            self.user_id,
            name="Шкаф",
            component_type="base-cabinet",
        )
        first = await self.repository.create_revision(
            self.user_id,
            definition["id"],
            document={"schemaVersion": 2, "value": "first"},
            placement_metadata={"widthMm": 600},
        )
        second = await self.repository.create_revision(
            self.user_id,
            definition["id"],
            document={"schemaVersion": 2, "value": "second"},
            placement_metadata={"widthMm": 800},
            based_on_revision_id=first["id"],
        )

        restored_first = await self.repository.get_revision(self.user_id, first["id"])
        self.assertEqual(first["revision_number"], 1)
        self.assertEqual(second["revision_number"], 2)
        self.assertEqual(restored_first["document"]["value"], "first")

    async def test_stale_base_revision_is_rejected(self):
        definition = await self.repository.create_definition(self.user_id, name="Шкаф")
        first = await self.repository.create_revision(
            self.user_id, definition["id"], document={"schemaVersion": 2}, placement_metadata={}
        )
        await self.repository.create_revision(
            self.user_id, definition["id"], document={"schemaVersion": 2},
            placement_metadata={}, based_on_revision_id=first["id"],
        )

        with self.assertRaises(RevisionConflict):
            await self.repository.create_revision(
                self.user_id, definition["id"], document={"schemaVersion": 2},
                placement_metadata={}, based_on_revision_id=first["id"],
            )

    async def test_other_owner_cannot_read_definition_or_revision(self):
        definition = await self.repository.create_definition(self.user_id, name="Частный шкаф")
        revision = await self.repository.create_revision(
            self.user_id, definition["id"], document={"schemaVersion": 2}, placement_metadata={}
        )

        self.assertIsNone(await self.repository.get_definition(self.other_user_id, definition["id"]))
        self.assertIsNone(await self.repository.get_revision(self.other_user_id, revision["id"]))


if __name__ == "__main__":
    unittest.main()
