import uuid

from quart import Blueprint, jsonify, request

from ..auth.decorators import require_company
from ..database import editor_orm
from ..helpers import camel_row
from ..repositories.catalog import CatalogRepository


controller = Blueprint("editor-catalog", __name__)


@controller.get("/api/editor/catalog/manufacturers")
@require_company
async def manufacturers():
    rows = await CatalogRepository(editor_orm).list_manufacturers()
    return jsonify(manufacturers=[camel_row(row) for row in rows])


@controller.post("/api/editor/catalog/manufacturers")
@require_company
async def create_manufacturer():
    data = await request.get_json(silent=True) or {}
    if not data.get("code") or not data.get("name"):
        return jsonify(error="invalid_manufacturer"), 400
    row = await CatalogRepository(editor_orm).create_manufacturer(data["code"], data["name"])
    return jsonify(manufacturer=camel_row(row)), 201


@controller.get("/api/editor/catalog/products")
@require_company
async def products():
    rows = await CatalogRepository(editor_orm).list_products()
    return jsonify(products=[camel_row(row) for row in rows])


@controller.post("/api/editor/catalog/products")
@require_company
async def create_product():
    data = await request.get_json(silent=True) or {}
    try:
        manufacturer_id = uuid.UUID(str(data.get("manufacturerId")))
    except (TypeError, ValueError):
        return jsonify(error="invalid_manufacturer_id"), 400
    row = await CatalogRepository(editor_orm).create_product(
        manufacturer_id, data.get("code"), data.get("family"), data.get("name")
    )
    return jsonify(product=camel_row(row)), 201


@controller.get("/api/editor/catalog/products/<uuid:product_id>/versions")
@require_company
async def product_versions(product_id):
    rows = await CatalogRepository(editor_orm).list_product_versions(product_id)
    return jsonify(versions=[camel_row(row) for row in rows])


@controller.post("/api/editor/catalog/products/<uuid:product_id>/versions")
@require_company
async def create_product_version(product_id):
    data = await request.get_json(silent=True) or {}
    if not isinstance(data.get("data"), dict):
        return jsonify(error="invalid_catalog_data"), 400
    row = await CatalogRepository(editor_orm).create_product_version(
        product_id, data["data"], article_number=data.get("articleNumber")
    )
    return jsonify(version=camel_row(row)), 201


@controller.post("/api/editor/catalog/product-versions/<uuid:version_id>/mounting-patterns")
@require_company
async def create_mounting_pattern(version_id):
    data = await request.get_json(silent=True) or {}
    if not data.get("name") or not isinstance(data.get("operations"), list):
        return jsonify(error="invalid_mounting_pattern"), 400
    row = await CatalogRepository(editor_orm).create_mounting_pattern(
        version_id, data["name"], data["operations"]
    )
    return jsonify(pattern=camel_row(row)), 201


@controller.get("/api/editor/catalog/materials")
@require_company
async def materials():
    rows = await CatalogRepository(editor_orm).list_materials()
    return jsonify(materials=[camel_row(row) for row in rows])


@controller.post("/api/editor/catalog/materials")
@require_company
async def create_material():
    data = await request.get_json(silent=True) or {}
    if not data.get("code") or not data.get("name"):
        return jsonify(error="invalid_material"), 400
    row = await CatalogRepository(editor_orm).create_material(data["code"], data["name"])
    return jsonify(material=camel_row(row)), 201


@controller.get("/api/editor/catalog/materials/<uuid:material_id>/versions")
@require_company
async def material_versions(material_id):
    rows = await CatalogRepository(editor_orm).list_material_versions(material_id)
    return jsonify(versions=[camel_row(row) for row in rows])


@controller.post("/api/editor/catalog/materials/<uuid:material_id>/versions")
@require_company
async def create_material_version(material_id):
    data = await request.get_json(silent=True) or {}
    if not isinstance(data.get("data"), dict):
        return jsonify(error="invalid_catalog_data"), 400
    row = await CatalogRepository(editor_orm).create_material_version(material_id, data["data"])
    return jsonify(version=camel_row(row)), 201
