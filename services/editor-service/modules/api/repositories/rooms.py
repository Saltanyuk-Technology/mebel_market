import json
import uuid


def _decoded(row):
    if not row:
        return None
    result = dict(row)
    for field in ("room_data", "scene_data", "transform", "placement"):
        if isinstance(result.get(field), str):
            result[field] = json.loads(result[field])
    return result


class RoomRepository:
    def __init__(self, orm):
        self.orm = orm

    async def create(self, user_id: int, project_id, name: str, room_data=None, scene_data=None):
        row = await self.orm.fetch_one(
            """INSERT INTO project_rooms (id, project_id, name, room_data, scene_data)
               SELECT $1, project.id, $4, $5::jsonb, $6::jsonb
               FROM projects AS project WHERE project.id = $2 AND project.user_id = $3
               RETURNING *""",
            uuid.uuid4(), project_id, user_id,
            str(name).strip()[:160] or "Новое помещение",
            json.dumps(room_data or {}), json.dumps(scene_data or {"placements": []}),
        )
        return _decoded(row)

    async def list(self, user_id: int, project_id):
        rows = await self.orm.fetch_all(
            """SELECT room.* FROM project_rooms AS room
               JOIN projects AS project ON project.id = room.project_id
               WHERE room.project_id = $1 AND project.user_id = $2
               ORDER BY room.updated_at DESC""",
            project_id, user_id,
        )
        return [_decoded(row) for row in rows]

    async def get(self, user_id: int, room_id):
        row = await self.orm.fetch_one(
            """SELECT room.* FROM project_rooms AS room
               JOIN projects AS project ON project.id = room.project_id
               WHERE room.id = $1 AND project.user_id = $2""",
            room_id, user_id,
        )
        return _decoded(row)

    async def update(self, user_id: int, room_id, *, name, room_data=None, scene_data=None):
        row = await self.orm.fetch_one(
            """UPDATE project_rooms AS room SET name = $3,
                 room_data = COALESCE($4::jsonb, room.room_data),
                 scene_data = COALESCE($5::jsonb, room.scene_data), updated_at = NOW()
               FROM projects AS project
               WHERE room.id = $1 AND project.id = room.project_id AND project.user_id = $2
               RETURNING room.*""",
            room_id, user_id, str(name).strip()[:160] or "Новое помещение",
            json.dumps(room_data) if room_data is not None else None,
            json.dumps(scene_data) if scene_data is not None else None,
        )
        return _decoded(row)

    async def delete(self, user_id: int, room_id):
        return await self.orm.fetch_val(
            """DELETE FROM project_rooms AS room USING projects AS project
               WHERE room.id = $1 AND project.id = room.project_id AND project.user_id = $2
               RETURNING room.id""",
            room_id, user_id,
        )

    async def list_instances(self, user_id: int, room_id):
        rows = await self.orm.fetch_all(
            """SELECT instance.* FROM furniture_instances AS instance
               JOIN project_rooms AS room ON room.id = instance.room_id
               JOIN projects AS project ON project.id = room.project_id
               WHERE instance.room_id = $1 AND project.user_id = $2
               ORDER BY instance.created_at""",
            room_id, user_id,
        )
        return [_decoded(row) for row in rows]

    async def create_instance(self, user_id: int, room_id, definition_id, revision_id, *, transform, placement=None):
        row = await self.orm.fetch_one(
            """INSERT INTO furniture_instances
                 (id, user_id, room_id, definition_id, revision_id, transform, placement)
               SELECT $1, $2, room.id, definition.id, revision.id, $6::jsonb, $7::jsonb
               FROM project_rooms AS room
               JOIN projects AS project ON project.id = room.project_id AND project.user_id = $2
               JOIN furniture_definitions AS definition
                 ON definition.id = $4 AND definition.user_id = $2
                AND definition.project_id = project.id
               JOIN furniture_revisions AS revision
                 ON revision.id = $5 AND revision.definition_id = definition.id
               WHERE room.id = $3 RETURNING *""",
            uuid.uuid4(), user_id, room_id, definition_id, revision_id,
            json.dumps(transform), json.dumps(placement or {}),
        )
        return _decoded(row)

    async def update_instance(self, user_id: int, room_id, instance_id, *, transform, placement):
        row = await self.orm.fetch_one(
            """UPDATE furniture_instances AS instance
               SET transform = $4::jsonb, placement = $5::jsonb, updated_at = NOW()
               FROM project_rooms AS room JOIN projects AS project ON project.id = room.project_id
               WHERE instance.id = $1 AND instance.room_id = $2 AND room.id = instance.room_id
                 AND project.user_id = $3 RETURNING instance.*""",
            instance_id, room_id, user_id, json.dumps(transform), json.dumps(placement or {}),
        )
        return _decoded(row)

    async def delete_instance(self, user_id: int, room_id, instance_id):
        return await self.orm.fetch_val(
            """DELETE FROM furniture_instances AS instance
               USING project_rooms AS room, projects AS project
               WHERE instance.id = $1 AND instance.room_id = $2 AND room.id = instance.room_id
                 AND project.id = room.project_id AND project.user_id = $3
               RETURNING instance.id""",
            instance_id, room_id, user_id,
        )
