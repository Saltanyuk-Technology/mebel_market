import asyncio
import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ..configuration import USER_SERVICE_URL


@dataclass(frozen=True)
class AuthenticatedCompany:
    user_id: int
    category: str = "company"


class AuthError(Exception):
    def __init__(self, status_code: int, code: str):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _request_json(url: str, cookie_header: str) -> tuple[int, dict]:
    request = Request(url, headers={"Cookie": cookie_header, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            payload = {}
        return error.code, payload
    except (URLError, TimeoutError, OSError) as error:
        raise ConnectionError("authentication_service_unavailable") from error


async def default_transport(url: str, cookie_header: str) -> tuple[int, dict]:
    return await asyncio.to_thread(_request_json, url, cookie_header)


class AuthClient:
    def __init__(self, base_url: str = USER_SERVICE_URL, transport=None):
        self.base_url = base_url.rstrip("/")
        self.transport = transport or default_transport

    async def current_company(self, cookie_header: str) -> AuthenticatedCompany:
        try:
            status, payload = await self.transport(
                f"{self.base_url}/api/auth/me",
                cookie_header or "",
            )
        except (ConnectionError, TimeoutError, OSError) as error:
            raise AuthError(503, "authentication_service_unavailable") from error
        if status == 401:
            raise AuthError(401, "authentication_required")
        if status != 200:
            raise AuthError(503, "authentication_service_unavailable")
        user = payload.get("user") if isinstance(payload, dict) else None
        if not isinstance(user, dict) or not isinstance(user.get("id"), int):
            raise AuthError(503, "invalid_authentication_response")
        if user.get("disabled") is True:
            raise AuthError(401, "authentication_required")
        if user.get("category") != "company":
            raise AuthError(403, "company_access_required")
        return AuthenticatedCompany(user_id=user["id"])
