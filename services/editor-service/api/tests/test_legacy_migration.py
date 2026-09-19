import unittest
import uuid

from api.database import editor_orm
from api.migrations.legacy import migrate_legacy, verify_legacy
from api.schema import ensure_schema
from api.tests.fixtures.legacy_data import FixtureLegacySource, legacy_fixture


class LegacyMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await editor_orm.startup()
        await ensure_schema(editor_orm)
        self.user_id = 8_000_000 + uuid.uuid4().int % 900_000
        self.fixture = legacy_fixture(self.user_id)
        self.source = FixtureLegacySource(self.fixture)

    async def asyncTearDown(self):
        await editor_orm.execute("DELETE FROM kitchen_projects WHERE user_id = $1", self.user_id)
        await editor_orm.execute("DELETE FROM furniture_definitions WHERE user_id = $1", self.user_id)
        await editor_orm.execute(
            "DELETE FROM migrated_records WHERE source_id = ANY($1::uuid[])",
            [
                self.fixture["kitchens"][0]["id"],
                self.fixture["projects"][0]["id"],
                self.fixture["library"][0]["id"],
            ],
        )
        await editor_orm.shutdown()

    async def test_second_run_creates_no_duplicates_and_preserves_ids(self):
        first = await migrate_legacy(self.source, editor_orm, source_fingerprint="fixture")
        second = await migrate_legacy(self.source, editor_orm, source_fingerprint="fixture")

        project = self.fixture["projects"][0]
        kitchen = self.fixture["kitchens"][0]
        definition = await editor_orm.fetch_one(
            "SELECT * FROM furniture_definitions WHERE id = $1", project["id"]
        )
        revision_count = await editor_orm.fetch_val(
            "SELECT count(*) FROM furniture_revisions WHERE definition_id = $1", project["id"]
        )
        instance_count = await editor_orm.fetch_val(
            "SELECT count(*) FROM furniture_instances WHERE kitchen_project_id = $1", kitchen["id"]
        )

        self.assertEqual(first.inserted, 3)
        self.assertEqual(second.inserted, 0)
        self.assertEqual(second.unchanged, 3)
        self.assertEqual(definition["id"], project["id"])
        self.assertEqual(definition["user_id"], self.user_id)
        self.assertEqual(definition["kitchen_project_id"], kitchen["id"])
        self.assertEqual(definition["autosaved"], project["autosaved"])
        self.assertEqual(revision_count, 1)
        self.assertEqual(instance_count, 1)

        verification = await verify_legacy(self.source, editor_orm)
        self.assertTrue(verification["valid"])
        self.assertEqual(verification["matched"], 3)

    async def test_dry_run_does_not_write_target_rows(self):
        report = await migrate_legacy(
            self.source, editor_orm, source_fingerprint="fixture-dry", dry_run=True
        )
        project_id = self.fixture["projects"][0]["id"]

        self.assertEqual(report.planned, 3)
        self.assertIsNone(await editor_orm.fetch_one(
            "SELECT id FROM furniture_definitions WHERE id = $1", project_id
        ))


if __name__ == "__main__":
    unittest.main()
