import os
import unittest
from unittest.mock import patch

from modules.api.configuration import editor_database_config
from server import create_app


class HealthTests(unittest.IsolatedAsyncioTestCase):
    async def test_health_endpoint_identifies_editor_api(self):
        app = create_app(install_database=False)
        response = await app.test_client().get("/api/editor/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            await response.get_json(),
            {"service": "editor-api", "status": "ok"},
        )

    def test_editor_database_uses_only_prefixed_configuration(self):
        environment = {
            "DB_HOST": "user-db",
            "DB_NAME": "mebel_market",
            "DB_USER": "user-service",
            "EDITOR_DB_HOST": "editor-db.example",
            "EDITOR_DB_PORT": "6543",
            "EDITOR_DB_NAME": "mebel_editor",
            "EDITOR_DB_USER": "editor-service",
            "EDITOR_DB_PASSWORD": "secret",
            "EDITOR_DB_POOL_MIN": "2",
            "EDITOR_DB_POOL_MAX": "7",
        }
        with patch.dict(os.environ, environment, clear=True):
            config = editor_database_config()

        self.assertEqual(config.host, "editor-db.example")
        self.assertEqual(config.port, 6543)
        self.assertEqual(config.database, "mebel_editor")
        self.assertEqual(config.user, "editor-service")
        self.assertEqual(config.password, "secret")
        self.assertEqual(config.min_size, 2)
        self.assertEqual(config.max_size, 7)


if __name__ == "__main__":
    unittest.main()
