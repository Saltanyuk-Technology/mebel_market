import unittest

from editor_client import EditorClient


class EditorClientProjectTests(unittest.IsolatedAsyncioTestCase):
    async def test_project_room_and_library_copy_use_workspace_endpoints(self):
        calls = []

        async def transport(method, url, cookie, body):
            calls.append((method, url, cookie, body))
            if url.endswith("/api/editor/projects") and method == "POST":
                return 201, {"project": {"id": "project-1"}}
            if url.endswith("/api/editor/projects/project-1/rooms"):
                return 201, {"room": {"id": "room-1"}}
            if url.endswith("/api/editor/library/library-1/copy-to-project"):
                return 201, {"definition": {"id": "copy-1"}}
            raise AssertionError(f"unexpected request: {method} {url}")

        client = EditorClient(base_url="http://editor", transport=transport)
        project = await client.create_project({"name": "Дом"}, "session=1")
        room = await client.create_room("project-1", {"name": "Кухня"}, "session=1")
        copied = await client.copy_library_to_project(
            "library-1", "project-1", "session=1"
        )

        self.assertEqual(project["project"]["id"], "project-1")
        self.assertEqual(room["room"]["id"], "room-1")
        self.assertEqual(copied["definition"]["id"], "copy-1")
        self.assertEqual(
            [(method, url.removeprefix("http://editor"), body) for method, url, _, body in calls],
            [
                ("POST", "/api/editor/projects", {"name": "Дом"}),
                ("POST", "/api/editor/projects/project-1/rooms", {"name": "Кухня"}),
                (
                    "POST",
                    "/api/editor/library/library-1/copy-to-project",
                    {"projectId": "project-1"},
                ),
            ],
        )


if __name__ == "__main__":
    unittest.main()
