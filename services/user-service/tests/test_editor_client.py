import unittest

from editor_client import EditorApiError, EditorClient


class EditorClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_and_cookie_forwarding(self):
        calls = []

        async def transport(method, url, cookie, body):
            calls.append((method, url, cookie, body))
            return 200, {"kitchens": [{"id": "one"}]}

        result = await EditorClient(base_url="http://editor", transport=transport).list_kitchens("session=secret")
        self.assertEqual(result[0]["id"], "one")
        self.assertEqual(calls[0][2], "session=secret")

    async def test_editor_api_outage_is_structured_503(self):
        async def transport(*_args):
            raise ConnectionError()

        with self.assertRaises(EditorApiError) as raised:
            await EditorClient(transport=transport).list_definitions("session=x")
        self.assertEqual(raised.exception.status_code, 503)

    async def test_remote_auth_error_is_preserved(self):
        async def transport(*_args):
            return 401, {"error": "authentication_required"}

        with self.assertRaises(EditorApiError) as raised:
            await EditorClient(transport=transport).list_kitchens("")
        self.assertEqual(raised.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
