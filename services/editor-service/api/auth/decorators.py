from functools import wraps

from quart import current_app, g, jsonify, request

from .client import AuthError


def require_company(handler):
    @wraps(handler)
    async def wrapped(*args, **kwargs):
        try:
            g.company = await current_app.extensions["editor_auth_client"].current_company(
                request.headers.get("Cookie", "")
            )
        except AuthError as error:
            return jsonify(error=error.code), error.status_code
        return await handler(*args, **kwargs)

    return wrapped
