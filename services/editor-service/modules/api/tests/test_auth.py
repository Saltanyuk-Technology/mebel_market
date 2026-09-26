import unittest

from modules.api.auth.client import AuthClient, AuthError


class AuthClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_active_company_is_returned(self):
        async def transport(_url, cookie):
            self.assertEqual(cookie, "mebel_session=session-id")
            return 200, {
                "status": "success",
                "user": {"id": 42, "category": "company", "disabled": False},
            }

        company = await AuthClient(transport=transport).current_company("mebel_session=session-id")

        self.assertEqual(company.user_id, 42)
        self.assertEqual(company.category, "company")

    async def test_missing_or_expired_session_is_unauthorized(self):
        async def transport(_url, _cookie):
            return 401, {"status": "error"}

        with self.assertRaises(AuthError) as caught:
            await AuthClient(transport=transport).current_company("")

        self.assertEqual(caught.exception.status_code, 401)
        self.assertEqual(caught.exception.code, "authentication_required")

    async def test_non_company_user_is_forbidden(self):
        async def transport(_url, _cookie):
            return 200, {
                "status": "success",
                "user": {"id": 7, "category": "user", "disabled": False},
            }

        with self.assertRaises(AuthError) as caught:
            await AuthClient(transport=transport).current_company("session=ok")

        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.code, "company_access_required")

    async def test_unavailable_user_service_is_service_unavailable(self):
        async def transport(_url, _cookie):
            raise TimeoutError("user service timeout")

        with self.assertRaises(AuthError) as caught:
            await AuthClient(transport=transport).current_company("session=ok")

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.code, "authentication_service_unavailable")


if __name__ == "__main__":
    unittest.main()
