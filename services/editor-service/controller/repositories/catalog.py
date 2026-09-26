import json
import uuid


def _row(row):
    result = dict(row) if row else None
    for field in ("data", "operations", "metadata"):
        if result and isinstance(result.get(field), str):
            result[field] = json.loads(result[field])
    return result


class CatalogRepository:
    def __init__(self, orm):
        self.orm = orm

    async def get_product_version(self, version_id):
        return _row(await self.orm.fetch_one(
            "SELECT * FROM catalog_product_versions WHERE id = $1", version_id
        ))

    async def create_manufacturer(self, code, name):
        return _row(await self.orm.fetch_one(
            """INSERT INTO catalog_manufacturers (id, code, name) VALUES ($1, $2, $3)
               RETURNING *""", uuid.uuid4(), str(code).strip(), str(name).strip(),
        ))

    async def list_manufacturers(self):
        return [_row(row) for row in await self.orm.fetch_all(
            "SELECT * FROM catalog_manufacturers ORDER BY name"
        )]

    async def create_product(self, manufacturer_id, code, family, name):
        return _row(await self.orm.fetch_one(
            """INSERT INTO catalog_products (id, manufacturer_id, code, family, name)
               VALUES ($1, $2, $3, $4, $5) RETURNING *""",
            uuid.uuid4(), manufacturer_id, str(code).strip(), str(family).strip(), str(name).strip(),
        ))

    async def list_products(self):
        return [_row(row) for row in await self.orm.fetch_all(
            "SELECT * FROM catalog_products ORDER BY family, name"
        )]

    async def create_product_version(self, product_id, data, *, article_number=None, active=True):
        async def operation(session):
            version = await session.fetchval(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM catalog_product_versions WHERE product_id = $1",
                product_id,
            )
            row = await session.fetch_one(
                """INSERT INTO catalog_product_versions
                     (id, product_id, version_number, article_number, data, active_for_new_projects)
                   VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *""",
                uuid.uuid4(), product_id, version, article_number, json.dumps(data), active,
            )
            return _row(row)
        return await self.orm.run_transaction(operation)

    async def list_product_versions(self, product_id):
        return [_row(row) for row in await self.orm.fetch_all(
            "SELECT * FROM catalog_product_versions WHERE product_id = $1 ORDER BY version_number",
            product_id,
        )]

    async def create_material(self, code, name):
        return _row(await self.orm.fetch_one(
            "INSERT INTO catalog_materials (id, code, name) VALUES ($1, $2, $3) RETURNING *",
            uuid.uuid4(), str(code).strip(), str(name).strip(),
        ))

    async def list_materials(self):
        return [_row(row) for row in await self.orm.fetch_all(
            "SELECT * FROM catalog_materials ORDER BY name"
        )]

    async def create_material_version(self, material_id, data, *, active=True):
        async def operation(session):
            version = await session.fetchval(
                "SELECT COALESCE(MAX(version_number), 0) + 1 FROM catalog_material_versions WHERE material_id = $1",
                material_id,
            )
            return _row(await session.fetch_one(
                """INSERT INTO catalog_material_versions
                     (id, material_id, version_number, data, active_for_new_projects)
                   VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING *""",
                uuid.uuid4(), material_id, version, json.dumps(data), active,
            ))
        return await self.orm.run_transaction(operation)

    async def list_material_versions(self, material_id):
        return [_row(row) for row in await self.orm.fetch_all(
            "SELECT * FROM catalog_material_versions WHERE material_id = $1 ORDER BY version_number",
            material_id,
        )]

    async def create_mounting_pattern(self, product_version_id, name, operations):
        return _row(await self.orm.fetch_one(
            """INSERT INTO catalog_mounting_patterns (id, product_version_id, name, operations)
               VALUES ($1, $2, $3, $4::jsonb) RETURNING *""",
            uuid.uuid4(), product_version_id, str(name).strip(), json.dumps(operations),
        ))
