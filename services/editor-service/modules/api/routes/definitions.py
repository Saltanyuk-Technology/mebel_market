import uuid

from quart import Blueprint, g, jsonify, request

from ..auth.decorators import require_company
from ..database import editor_orm
from ..helpers import camel_row
from ..repositories.definitions import DefinitionRepository, RevisionConflict
from ..repositories.projects import ProjectRepository
from ..services.revisions import InvalidDocument, require_valid_document


controller = Blueprint("editor-definitions", __name__)


def _uuid(value):
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


@controller.get("/api/editor/definitions")
@require_company
async def list_definitions():
    project_id = request.args.get("projectId")
    if project_id and not _uuid(project_id):
        return jsonify(error="invalid_project_id"), 400
    rows = await DefinitionRepository(editor_orm).list_definitions(
        g.company.user_id, project_id=_uuid(project_id)
    )
    return jsonify(definitions=[camel_row(row) for row in rows])


@controller.post("/api/editor/definitions")
@require_company
async def create_definition():
    payload = await request.get_json(silent=True) or {}
    document = payload.get("document")
    try:
        require_valid_document(document)
    except InvalidDocument as error:
        return jsonify(error="invalid_furniture_document", violations=error.violations), 422
    project_id = _uuid(payload.get("projectId"))
    if payload.get("projectId") and not project_id:
        return jsonify(error="invalid_project_id"), 400
    if project_id and not await ProjectRepository(editor_orm).get(g.company.user_id, project_id):
        return jsonify(error="project_not_found"), 404
    repository = DefinitionRepository(editor_orm)
    definition = await repository.create_definition(
        g.company.user_id,
        name=payload.get("name") or document.get("metadata", {}).get("name") or "Новый элемент",
        component_type=payload.get("componentType") or document.get("metadata", {}).get("componentType") or "cabinet",
        project_id=project_id,
    )
    revision = await repository.create_revision(
        g.company.user_id, definition["id"], document=document,
        placement_metadata=payload.get("placementMetadata") or document.get("placement") or {},
    )
    return jsonify(definition=camel_row(definition), revision=camel_row(revision)), 201


@controller.get("/api/editor/definitions/<uuid:definition_id>")
@require_company
async def get_definition(definition_id):
    repository = DefinitionRepository(editor_orm)
    definition = await repository.get_definition(g.company.user_id, definition_id)
    if not definition:
        return jsonify(error="not_found"), 404
    revision = None
    if definition.get("latest_revision_id"):
        revision = await repository.get_revision(g.company.user_id, definition["latest_revision_id"])
    return jsonify(definition=camel_row(definition), revision=camel_row(revision) if revision else None)


@controller.get("/api/editor/definitions/<uuid:definition_id>/revisions")
@require_company
async def list_revisions(definition_id):
    rows = await DefinitionRepository(editor_orm).list_revisions(g.company.user_id, definition_id)
    if not rows and not await DefinitionRepository(editor_orm).get_definition(g.company.user_id, definition_id):
        return jsonify(error="not_found"), 404
    return jsonify(revisions=[camel_row(row) for row in rows])


@controller.post("/api/editor/definitions/<uuid:definition_id>/revisions")
@require_company
async def create_revision(definition_id):
    payload = await request.get_json(silent=True) or {}
    document = payload.get("document")
    try:
        require_valid_document(document)
    except InvalidDocument as error:
        return jsonify(error="invalid_furniture_document", violations=error.violations), 422
    based_on = _uuid(payload.get("basedOnRevisionId"))
    if payload.get("basedOnRevisionId") and not based_on:
        return jsonify(error="invalid_revision_id"), 400
    try:
        revision = await DefinitionRepository(editor_orm).create_revision(
            g.company.user_id, definition_id, document=document,
            placement_metadata=payload.get("placementMetadata") or document.get("placement") or {},
            based_on_revision_id=based_on,
        )
    except RevisionConflict:
        return jsonify(error="stale_base_revision"), 409
    if not revision:
        return jsonify(error="not_found"), 404
    return jsonify(revision=camel_row(revision)), 201


@controller.get("/api/editor/revisions/<uuid:revision_id>")
@require_company
async def get_revision(revision_id):
    revision = await DefinitionRepository(editor_orm).get_revision(g.company.user_id, revision_id)
    return (jsonify(revision=camel_row(revision)), 200) if revision else (jsonify(error="not_found"), 404)
