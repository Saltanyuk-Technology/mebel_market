from quart import redirect, render_template

from modules.auth.service import get_current_user
from .helpers import ROLE, TEMPLATE


async def dashboard():
    user = await get_current_user()
    if not user or user["disabled"] or user["category"] != ROLE:
        return redirect("/")
    return await render_template(TEMPLATE, user=user)
