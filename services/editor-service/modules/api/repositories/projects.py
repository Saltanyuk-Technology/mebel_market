import uuid


class ProjectRepository:
    def __init__(self, orm):
        self.orm = orm

    async def create(self, user_id: int, name: str):
        row = await self.orm.fetch_one(
            """INSERT INTO projects (id, user_id, name)
               VALUES ($1, $2, $3) RETURNING *""",
            uuid.uuid4(), user_id, str(name).strip()[:160] or "Новый проект",
        )
        return dict(row)

    async def get(self, user_id: int, project_id):
        row = await self.orm.fetch_one(
            """SELECT project.*,
                      (SELECT COUNT(*) FROM project_rooms WHERE project_id = project.id) AS room_count,
                      (SELECT COUNT(*) FROM furniture_definitions
                       WHERE project_id = project.id) AS furniture_count
               FROM projects AS project
               WHERE project.id = $1 AND project.user_id = $2""",
            project_id, user_id,
        )
        return dict(row) if row else None

    async def list(self, user_id: int):
        rows = await self.orm.fetch_all(
            """SELECT project.*,
                      (SELECT COUNT(*) FROM project_rooms WHERE project_id = project.id) AS room_count,
                      (SELECT COUNT(*) FROM furniture_definitions
                       WHERE project_id = project.id) AS furniture_count
               FROM projects AS project
               WHERE project.user_id = $1 ORDER BY project.updated_at DESC""",
            user_id,
        )
        return [dict(row) for row in rows]

    async def update(self, user_id: int, project_id, name: str):
        row = await self.orm.fetch_one(
            """UPDATE projects SET name = $3, updated_at = NOW()
               WHERE id = $1 AND user_id = $2 RETURNING *""",
            project_id, user_id, str(name).strip()[:160] or "Новый проект",
        )
        return dict(row) if row else None

    async def delete(self, user_id: int, project_id):
        return await self.orm.fetch_val(
            "DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id",
            project_id, user_id,
        )
