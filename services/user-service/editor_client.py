import asyncio
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


EDITOR_API_URL = os.getenv("EDITOR_API_URL", "http://127.0.0.1:8081").rstrip("/")


class EditorApiError(Exception):
    def __init__(self, status_code, code):
        super().__init__(code)
        self.status_code = status_code
        self.code = code


def _sync_transport(method, url, cookie, body):
    encoded = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json", "Cookie": cookie or ""}
    if encoded is not None:
        headers["Content-Type"] = "application/json"
    request = Request(url, data=encoded, headers=headers, method=method)
    try:
        with urlopen(request, timeout=8) as response:
            raw = response.read()
            return response.status, json.loads(raw.decode("utf-8")) if raw else {}
    except HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except (ValueError, UnicodeDecodeError):
            payload = {}
        return error.code, payload
    except (URLError, TimeoutError, OSError) as error:
        raise ConnectionError("editor_api_unavailable") from error


async def default_transport(method, url, cookie, body):
    return await asyncio.to_thread(_sync_transport, method, url, cookie, body)


class EditorClient:
    def __init__(self, base_url=EDITOR_API_URL, transport=None):
        self.base_url = base_url.rstrip("/")
        self.transport = transport or default_transport

    async def request(self, method, path, cookie="", body=None):
        try:
            status, payload = await self.transport(method, f"{self.base_url}{path}", cookie, body)
        except (ConnectionError, TimeoutError, OSError) as error:
            raise EditorApiError(503, "editor_api_unavailable") from error
        if not 200 <= status < 300:
            raise EditorApiError(status, payload.get("error", "editor_api_error"))
        return payload

    async def list_projects(self, cookie):
        return (await self.request("GET", "/api/editor/projects", cookie)).get("projects", [])

    async def get_project(self, project_id, cookie):
        return await self.request("GET", f"/api/editor/projects/{project_id}", cookie)

    async def create_project(self, data, cookie):
        return await self.request("POST", "/api/editor/projects", cookie, data)

    async def update_project(self, project_id, data, cookie):
        return await self.request("PUT", f"/api/editor/projects/{project_id}", cookie, data)

    async def delete_project(self, project_id, cookie):
        return await self.request("DELETE", f"/api/editor/projects/{project_id}", cookie)

    async def create_room(self, project_id, data, cookie):
        return await self.request(
            "POST", f"/api/editor/projects/{project_id}/rooms", cookie, data
        )

    async def list_project_definitions(self, project_id, cookie):
        return (
            await self.request(
                "GET", f"/api/editor/definitions?projectId={project_id}", cookie
            )
        ).get("definitions", [])

    async def list_library(self, cookie):
        return (await self.request("GET", "/api/editor/library", cookie)).get("items", [])

    async def copy_library_to_project(self, item_id, project_id, cookie):
        return await self.request(
            "POST",
            f"/api/editor/library/{item_id}/copy-to-project",
            cookie,
            {"projectId": str(project_id)},
        )


editor_client = EditorClient()
