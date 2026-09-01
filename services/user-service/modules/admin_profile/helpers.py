ROLE = "admin"
TEMPLATE = "admin.html"


def can_manage_account(admin, user_id: int) -> bool:
    return bool(admin) and not admin["disabled"] and admin["category"] == ROLE and int(admin["id"]) != user_id
