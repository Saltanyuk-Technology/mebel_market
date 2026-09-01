from uuid import UUID

from database import orm


class UserRepository:
    async def find_by_email(self, email: str):
        return await orm.fetch_one(
            """SELECT id, email, password_hash, firstname, secondname, phone,
                      category, confirmed, disabled, created_at, last_login_at
               FROM users WHERE email = $1""",
            email,
        )

    async def create(self, *, email, password_hash, firstname, secondname, phone, category):
        return await orm.fetch_one(
            """INSERT INTO users
                   (email, password_hash, firstname, secondname, phone, category)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id, email, firstname, secondname, phone, category,
                         confirmed, disabled, created_at, last_login_at""",
            email, password_hash, firstname, secondname, phone, category,
        )

    async def mark_login(self, user_id: int) -> None:
        await orm.execute(
            "UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1",
            user_id,
        )

    async def dashboard_stats(self):
        return await orm.fetch_one(
            """SELECT COUNT(*)::int AS total,
                      COUNT(*) FILTER (WHERE category = 'user')::int AS users,
                      COUNT(*) FILTER (WHERE category = 'company')::int AS companies,
                      COUNT(*) FILTER (WHERE category = 'admin')::int AS admins,
                      COUNT(*) FILTER (WHERE disabled)::int AS disabled
               FROM users"""
        )

    async def list_for_admin(self, limit: int = 100):
        return await orm.fetch_all(
            """SELECT id, email, firstname, secondname, phone, category,
                      confirmed, disabled, created_at, last_login_at
               FROM users ORDER BY created_at DESC LIMIT $1""",
            limit,
        )

    async def set_disabled(self, user_id: int, disabled: bool):
        return await orm.fetch_one(
            """UPDATE users SET disabled = $2, updated_at = NOW()
               WHERE id = $1 RETURNING id, disabled""",
            user_id, disabled,
        )


class SessionRepository:
    async def create(self, session_id, user_id, expires_at) -> None:
        await orm.execute(
            "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ($1, $2, $3)",
            session_id, user_id, expires_at,
        )

    async def get_user(self, session_id):
        try:
            session_id = UUID(str(session_id))
        except (TypeError, ValueError):
            return None
        return await orm.fetch_one(
            """SELECT u.id, u.email, u.firstname, u.secondname, u.phone,
                      u.category, u.confirmed, u.disabled, u.created_at, u.last_login_at
               FROM auth_sessions s JOIN users u ON u.id = s.user_id
               WHERE s.id = $1 AND s.expires_at > NOW()""",
            session_id,
        )

    async def delete_all_for_user(self, user_id: int) -> None:
        await orm.execute("DELETE FROM auth_sessions WHERE user_id = $1", user_id)

    async def delete(self, session_id) -> None:
        try:
            session_id = UUID(str(session_id))
        except (TypeError, ValueError):
            return
        await orm.execute("DELETE FROM auth_sessions WHERE id = $1", session_id)
