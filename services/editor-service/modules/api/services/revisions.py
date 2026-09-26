class InvalidDocument(Exception):
    def __init__(self, violations):
        super().__init__("invalid_furniture_document")
        self.violations = violations


def validate_document(document):
    violations = []
    if not isinstance(document, dict) or document.get("schemaVersion") != 2:
        violations.append({"code": "INVALID_SCHEMA_VERSION"})
        return violations
    if document.get("documentType") != "furniture-definition":
        violations.append({"code": "INVALID_DOCUMENT_TYPE"})
        return violations
    entities = document.get("entities")
    if not isinstance(entities, dict):
        return [{"code": "MISSING_ENTITIES"}]
    assemblies = entities.get("assemblies")
    if not isinstance(assemblies, list):
        return [{"code": "MISSING_ASSEMBLIES"}]
    roots = [item for item in assemblies if item.get("parentAssemblyId") is None]
    if len(roots) != 1:
        violations.append({"code": "INVALID_ROOT_COUNT", "count": len(roots)})
    ids = [item.get("id") for collection in entities.values() if isinstance(collection, list) for item in collection if isinstance(item, dict)]
    if None in ids or len(ids) != len(set(ids)):
        violations.append({"code": "INVALID_ENTITY_IDS"})
    root_id = document.get("rootAssemblyId")
    assembly_ids = {item.get("id") for item in assemblies}
    if root_id not in assembly_ids or (len(roots) == 1 and roots[0].get("id") != root_id):
        violations.append({"code": "ROOT_ASSEMBLY_MISMATCH"})
    for collection in ("panels", "facades", "hardwareInstances"):
        for entity in entities.get(collection, []):
            if entity.get("ownerAssemblyId") not in assembly_ids:
                violations.append({"code": "ORPHAN_ENTITY", "entityId": entity.get("id")})
    return violations


def require_valid_document(document):
    violations = validate_document(document)
    if violations:
        raise InvalidDocument(violations)
