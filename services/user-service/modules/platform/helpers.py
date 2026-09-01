ROLE_DESTINATIONS = {"user": "/user", "company": "/company", "admin": "/admin"}


def dashboard_for(category: str) -> str:
    return ROLE_DESTINATIONS.get(category, "/user")
