import json
import uuid


class KitchenRepository:
    def __init__(self, orm):
        self.orm = orm

    async def create(self, user_id: int, name: str, room_data=None, scene_data=None, project_id=None):
        row = await self.orm.fetch_one(
            """INSERT INTO kitchen_projects (id, user_id, name, room_data, scene_data)
               VALUES ($1, $2, $3, $4::jsonb, $5::jsonb) RETURNING *""",
            project_id or uuid.uuid4(), user_id, str(name).strip()[:160] or "Новый проект кухни",
            json.dumps(room_data or {}), json.dumps(scene_data or {"placements": []}),
        )
        return dict(row)

    async def get(self, user_id: int, project_id):
        row = await self.orm.fetch_one(
            "SELECT * FROM kitchen_projects WHERE id = $1 AND user_id = $2", project_id, user_id
        )
        return dict(row) if row else None

    async def list(self, user_id: int):
        rows = await self.orm.fetch_all(
            "SELECT * FROM kitchen_projects WHERE user_id = $1 ORDER BY updated_at DESC", user_id
        )
        return [dict(row) for row in rows]

    async def update(self, user_id: int, project_id, *, name, room_data=None, scene_data=None):
        row = await self.orm.fetch_one(
            """UPDATE kitchen_projects SET name = $3,
                 room_data = COALESCE($4::jsonb, room_data),
                 scene_data = COALESCE($5::jsonb, scene_data), updated_at = NOW()
               WHERE id = $1 AND user_id = $2 RETURNING *""",
            project_id, user_id, str(name).strip()[:160] or "Новый проект кухни",
            json.dumps(room_data) if room_data is not None else None,
            json.dumps(scene_data) if scene_data is not None else None,
        )
        return dict(row) if row else None

    async def delete(self, user_id: int, project_id):
        return await self.orm.fetch_val(
            "DELETE FROM kitchen_projects WHERE id = $1 AND user_id = $2 RETURNING id",
            project_id, user_id,
        )

    async def list_instances(self, user_id: int, project_id):
        rows = await self.orm.fetch_all(
            """SELECT instance.* FROM furniture_instances AS instance
               JOIN kitchen_projects AS kitchen ON kitchen.id = instance.kitchen_project_id
               WHERE instance.kitchen_project_id = $1 AND kitchen.user_id = $2
               ORDER BY instance.created_at""", project_id, user_id,
        )
        return [dict(row) for row in rows]

    async def create_instance(self, user_id: int, project_id, definition_id, revision_id, *, transform, placement=None, instance_id=None):
        row = await self.orm.fetch_one(
            """INSERT INTO furniture_instances
                 (id, user_id, kitchen_project_id, definition_id, revision_id, transform, placement)
               SELECT $1, $2, kitchen.id, definition.id, revision.id, $6::jsonb, $7::jsonb
               FROM kitchen_projects AS kitchen
               JOIN furniture_definitions AS definition ON definition.id = $4 AND definition.user_id = $2
               JOIN furniture_revisions AS revision ON revision.id = $5 AND revision.definition_id = definition.id
               WHERE kitchen.id = $3 AND kitchen.user_id = $2 RETURNING *""",
            instance_id or uuid.uuid4(), user_id, project_id, definition_id, revision_id,
            json.dumps(transform), json.dumps(placement or {}),
        )
        return dict(row) if row else None

    async def revision_update_context(self, user_id: int, project_id, instance_id, next_revision_id):
        instance = await self.orm.fetch_one(
            """SELECT instance.*, kitchen.room_data FROM furniture_instances AS instance
               JOIN kitchen_projects AS kitchen ON kitchen.id = instance.kitchen_project_id
               WHERE instance.id = $1 AND instance.kitchen_project_id = $2 AND kitchen.user_id = $3""",
            instance_id, project_id, user_id,
        )
        if not instance:
            return None
        current = await self.orm.fetch_one(
            "SELECT * FROM furniture_revisions WHERE id = $1", instance["revision_id"]
        )
        following = await self.orm.fetch_one(
            """SELECT revision.* FROM furniture_revisions AS revision
               JOIN furniture_definitions AS definition ON definition.id = revision.definition_id
               WHERE revision.id = $1 AND definition.id = $2 AND definition.user_id = $3""",
            next_revision_id, instance["definition_id"], user_id,
        )
        if not following:
            return None
        neighbors = await self.orm.fetch_all(
            """SELECT neighbor.*, revision.document, revision.placement_metadata
               FROM furniture_instances AS neighbor
               JOIN furniture_revisions AS revision ON revision.id = neighbor.revision_id
               WHERE neighbor.kitchen_project_id = $1 AND neighbor.id <> $2""",
            project_id, instance_id,
        )
        return dict(instance), dict(current), dict(following), [dict(row) for row in neighbors]

    async def apply_revision_update(self, user_id: int, project_id, instance_id, revision_id, transform):
        row = await self.orm.fetch_one(
            """UPDATE furniture_instances AS instance SET revision_id = $4, transform = $5::jsonb, updated_at = NOW()
               FROM kitchen_projects AS kitchen
               WHERE instance.id = $1 AND instance.kitchen_project_id = $2
                 AND kitchen.id = instance.kitchen_project_id AND kitchen.user_id = $3
               RETURNING instance.*""",
            instance_id, project_id, user_id, revision_id, json.dumps(transform),
        )
        return dict(row) if row else None

    async def update_instance(self, user_id: int, project_id, instance_id, *, transform, placement):
        row = await self.orm.fetch_one(
            """UPDATE furniture_instances AS instance
               SET transform = $4::jsonb, placement = $5::jsonb, updated_at = NOW()
               FROM kitchen_projects AS kitchen
               WHERE instance.id = $1 AND instance.kitchen_project_id = $2
                 AND kitchen.id = instance.kitchen_project_id AND kitchen.user_id = $3
               RETURNING instance.*""",
            instance_id, project_id, user_id, json.dumps(transform), json.dumps(placement or {}),
        )
        return dict(row) if row else None

    async def delete_instance(self, user_id: int, project_id, instance_id):
        return await self.orm.fetch_val(
            """DELETE FROM furniture_instances AS instance USING kitchen_projects AS kitchen
               WHERE instance.id = $1 AND instance.kitchen_project_id = $2
                 AND kitchen.id = instance.kitchen_project_id AND kitchen.user_id = $3
               RETURNING instance.id""", instance_id, project_id, user_id,
        )
