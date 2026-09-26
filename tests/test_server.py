import unittest
from pathlib import Path
from unittest.mock import patch

import server


class ServerEnvironmentTests(unittest.TestCase):
    def test_child_python_path_contains_existing_airqore_package(self):
        with patch.dict("os.environ", {"PYTHONPATH": ""}):
            paths = server.child_environment()["PYTHONPATH"].split(";")

        package_roots = [
            Path(path)
            for path in paths
            if (Path(path) / "airqore_orm" / "__init__.py").is_file()
        ]

        self.assertTrue(package_roots, paths)


if __name__ == "__main__":
    unittest.main()
