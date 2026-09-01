from quart import request

from configuration import COOKIE_SECURE, SESSION_MAX_AGE


COOKIE_NAME = "mebel_session"


def session_id_from_request():
    return request.cookies.get(COOKIE_NAME)


def set_session_cookie(response, session_id: str, remember: bool = False) -> None:
    options = {
        "httponly": True, "secure": COOKIE_SECURE, "samesite": "Lax", "path": "/",
    }
    if remember:
        options["max_age"] = SESSION_MAX_AGE
    response.set_cookie(COOKIE_NAME, session_id, **options)


def delete_session_cookie(response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")
