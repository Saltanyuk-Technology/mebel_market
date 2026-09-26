from quart import jsonify, redirect, render_template, request

from modules.auth.repository import SessionRepository, UserRepository
from modules.auth.service import get_current_user
from .helpers import ROLE, TEMPLATE, can_manage_account


async def dashboard():
    admin = await get_current_user()
    if not admin or admin["disabled"] or admin["category"] != ROLE:
        return redirect("/")
    users = UserRepository()
    return await render_template(
        TEMPLATE, user=admin,
        stats=await users.dashboard_stats(), users=await users.list_for_admin(),
    )


async def update_user(user_id: int):
    admin = await get_current_user()
    if not admin or admin["disabled"] or admin["category"] != ROLE:
        return jsonify(status="error", message="Недостаточно прав."), 403
    if not can_manage_account(admin, user_id):
        return jsonify(status="error", message="Нельзя отключить собственный аккаунт."), 400
    data = await request.get_json(silent=True) or {}
    if not isinstance(data.get("disabled"), bool):
        return jsonify(status="error", message="Некорректный статус аккаунта."), 400
    users = UserRepository()
    updated = await users.set_disabled(user_id, data["disabled"])
    if not updated:
        return jsonify(status="error", message="Пользователь не найден."), 404
    if data["disabled"]:
        await SessionRepository().delete_all_for_user(user_id)
    return jsonify(status="success", user={"id": updated["id"], "disabled": updated["disabled"]})
