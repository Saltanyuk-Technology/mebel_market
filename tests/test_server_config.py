import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ServerConfigTests(unittest.TestCase):
    def test_local_cookie_secure_setting_is_boolean(self):
        from configuration.server_config import COOKIE_SECURE

        self.assertIs(COOKIE_SECURE, False)

    def test_database_config_loads_root_dotenv_from_service_directory(self):
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(ROOT)
        for name in ("DB_USER", "DB_NAME", "DB_PASSWORD", "DB_HOST", "DB_PORT"):
            environment.pop(name, None)

        result = subprocess.run(
            [sys.executable, "-c", "from configuration.server_config import orm"],
            cwd=ROOT / "services" / "user-service",
            env=environment,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_user_service_imports_from_service_directory(self):
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(ROOT)

        result = subprocess.run(
            [sys.executable, "-c", "from server import app"],
            cwd=ROOT / "services" / "user-service",
            env=environment,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
