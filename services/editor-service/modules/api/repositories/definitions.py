import json
import uuid


class RevisionConflict(Exception):
    pass


def _decoded(row):
    if not row:
        return None
    result = dict(row)
    for field in ("document", "placement_metadata"):
        if isinstance(result.get(field), str):
            result[field] = json.loads(result[field])
    return result


class DefinitionRepository:
    def __init__(self, orm):
        self.orm = orm

    async def create_definition(
        self,
        user_id: int,
        *,
        name: str,
        component_type: str = "cabinet",
        definition_id=None,
        project_id=None,
    ):
        row = await self.orm.fetch_one(
            """INSERT INTO furniture_definitions
                 (id, user_id, project_id, name, component_type)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *""",
            definition_id or uuid.uuid4(), user_id, project_id,
            str(name).strip()[:160] or "Новый элемент", component_type,
        )
        return dict(row)

    async def get_definition(self, user_id: int, definition_id):
        row = await self.orm.fetch_one(
            "SELECT * FROM furniture_definitions WHERE id = $1 AND user_id = $2",
            definition_id, user_id,
        )
        return dict(row) if row else None

    async def list_definitions(self, user_id: int, *, project_id=None):
        if project_id is not None:
            rows = await self.orm.fetch_all(
                """SELECT * FROM furniture_definitions
                   WHERE user_id = $1 AND project_id = $2 ORDER BY updated_at DESC""",
                user_id, project_id,
            )
            return [dict(row) for row in rows]
        rows = await self.orm.fetch_all(
            "SELECT * FROM furniture_definitions WHERE user_id = $1 ORDER BY updated_at DESC",
            user_id,
        )
        return [dict(row) for row in rows]

    async def get_revision(self, user_id: int, revision_id):
        row = await self.orm.fetch_one(
            """SELECT revision.* FROM furniture_revisions AS revision
               JOIN furniture_definitions AS definition ON definition.id = revision.definition_id
               WHERE revision.id = $1 AND definition.user_id = $2""",
            revision_id, user_id,
        )
        return _decoded(row)

    async def list_revisions(self, user_id: int, definition_id):
        rows = await self.orm.fetch_all(
            """SELECT revision.* FROM furniture_revisions AS revision
               JOIN furniture_definitions AS definition ON definition.id = revision.definition_id
               WHERE revision.definition_id = $1 AND definition.user_id = $2
               ORDER BY revision.revision_number DESC""",
            definition_id, user_id,
        )
        return [_decoded(row) for row in rows]

    async def create_revision(
        self,
        user_id: int,
        definition_id,
        *,
        document: dict,
        placement_metadata: dict,
        based_on_revision_id=None,
        revision_id=None,
    ):
        async def operation(session):
            definition = await session.fetch_one(
                """SELECT id, latest_revision_id FROM furniture_definitions
                   WHERE id = $1 AND user_id = $2 FOR UPDATE""",
                definition_id, user_id,
            )
            if not definition:
                return None
            latest = definition["latest_revision_id"]
            if latest != based_on_revision_id:
                if latest is not None or based_on_revision_id is not None:
                    raise RevisionConflict("stale_base_revision")
            revision_number = await session.fetchval(
                "SELECT COALESCE(MAX(revision_number), 0) + 1 FROM furniture_revisions WHERE definition_id = $1",
                definition_id,
            )
            row = await session.fetch_one(
                """INSERT INTO furniture_revisions
                     (id, definition_id, revision_number, based_on_revision_id, schema_version,
                      document, placement_metadata, created_by)
                   VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
                   RETURNING *""",
                revision_id or uuid.uuid4(), definition_id, revision_number,
                based_on_revision_id, int(document.get("schemaVersion", 0)),
                json.dumps(document), json.dumps(placement_metadata), user_id,
            )
            await session.execute(
                """UPDATE furniture_definitions
                   SET latest_revision_id = $2, updated_at = NOW() WHERE id = $1""",
                definition_id, row["id"],
            )
            return _decoded(row)

        return await self.orm.run_transaction(operation)
