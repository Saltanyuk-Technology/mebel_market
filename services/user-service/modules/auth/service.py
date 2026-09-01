import asyncio
import re
import uuid
from datetime import UTC, datetime, timedelta

from asyncpg import UniqueViolationError
from passlib.context import CryptContext
from quart import jsonify, request

from .helpers import delete_session_cookie, session_id_from_request, set_session_cookie
from .repository import SessionRepository, UserRepository


password_context = CryptContext(schemes=["bcrypt_sha256"], deprecated="auto")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PUBLIC_CATEGORIES = {"user", "company"}
SESSION_TTL = timedelta(days=14)
SESSION_BROWSER_TTL = timedelta(hours=12)


def serialize_user(user) -> dict:
    return {
        "id": int(user["id"]), "email": user["email"],
        "firstname": user["firstname"], "secondname": user["secondname"],
        "phone": user["phone"], "category": user["category"],
        "confirmed": bool(user["confirmed"]),
        "created_at": user["created_at"].isoformat(),
    }


async def get_current_user():
    session_id = session_id_from_request()
    return await SessionRepository().get_user(session_id) if session_id else None


async def register():
    data = await request.get_json(silent=True) or {}
    email = str(data.get("email") or "").strip().lower()
    password = str(data.get("password") or "")
    firstname = str(data.get("firstname") or "").strip()
    secondname = str(data.get("secondname") or "").strip()
    phone = str(data.get("phone") or "").strip() or None
    category = str(data.get("category") or "user").strip().lower()
    if not EMAIL_RE.fullmatch(email):
        return jsonify(status="error", message="Введите корректный email."), 400
    if not 8 <= len(password) <= 128:
        return jsonify(status="error", message="Пароль должен содержать от 8 до 128 символов."), 400
    if not firstname or not secondname:
        return jsonify(status="error", message="Укажите имя и фамилию."), 400
    if category not in PUBLIC_CATEGORIES:
        return jsonify(status="error", message="Недопустимый тип пользователя."), 400
    users = UserRepository()
    if await users.find_by_email(email):
        return jsonify(status="error", message="Пользователь уже существует."), 409
    password_hash = await asyncio.to_thread(password_context.hash, password)
    try:
        user = await users.create(
            email=email, password_hash=password_hash, firstname=firstname,
            secondname=secondname, phone=phone, category=category,
        )
    except UniqueViolationError:
        return jsonify(status="error", message="Пользователь уже существует."), 409
    return jsonify(status="success", user=serialize_user(user)), 201


async def login():
    data = await request.get_json(silent=True) or {}
    remember = data.get("remember") is True
    users = UserRepository()
    user = await users.find_by_email(str(data.get("email") or "").strip().lower())
    valid = bool(user) and await asyncio.to_thread(
        password_context.verify, data.get("password") or "", user["password_hash"]
    )
    if not valid:
        return jsonify(status="error", message="Неверный email или пароль."), 401
    if user["disabled"]:
        return jsonify(status="error", message="Учетная запись отключена."), 401
    await users.mark_login(int(user["id"]))
    session_id = uuid.uuid4()
    ttl = SESSION_TTL if remember else SESSION_BROWSER_TTL
    await SessionRepository().create(session_id, int(user["id"]), datetime.now(UTC) + ttl)
    response = jsonify(status="success", user=serialize_user(user))
    set_session_cookie(response, str(session_id), remember=remember)
    return response


async def logout():
    session_id = session_id_from_request()
    if session_id:
        await SessionRepository().delete(session_id)
    response = jsonify(status="success")
    delete_session_cookie(response)
    return response


async def me():
    user = await get_current_user()
    if not user or user["disabled"]:
        return jsonify(status="error", message="Требуется авторизация."), 401
    return jsonify(status="success", user=serialize_user(user))
