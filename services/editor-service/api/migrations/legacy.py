from dataclasses import dataclass
from datetime import date, datetime
import hashlib
import json
import math
import uuid


MIGRATION_NAMESPACE = uuid.UUID("5ac22bb2-5153-48d5-a544-29cb48d77297")


@dataclass
class MigrationReport:
    inserted: int = 0
    unchanged: int = 0
    planned: int = 0
    failed: int = 0

    def as_dict(self):
        return {
            "inserted": self.inserted,
            "unchanged": self.unchanged,
            "planned": self.planned,
            "failed": self.failed,
        }


def _json_default(value):
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    raise TypeError(f"Unsupported JSON value: {type(value)!r}")


def _json(value):
    return json.dumps(value, ensure_ascii=False, default=_json_default, separators=(",", ":"))


def _checksum(row):
    canonical = json.dumps(
        dict(row), ensure_ascii=False, default=_json_default, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _uuid(value, fallback_name):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return uuid.uuid5(MIGRATION_NAMESPACE, fallback_name)


def _entity_uuid(project_id, entity_type, legacy_id):
    return uuid.uuid5(MIGRATION_NAMESPACE, f"{project_id}:{entity_type}:{legacy_id}")


def _number(value, default=0):
    return value if isinstance(value, (int, float)) and math.isfinite(value) else default


def _rotated_extents(part):
    sizes = [_number(part.get("sizeX")), _number(part.get("sizeY")), _number(part.get("sizeZ"))]
    rotations = [
        math.radians(_number(part.get("rotationX"))),
        math.radians(_number(part.get("rotationY"))),
        math.radians(_number(part.get("rotationZ"))),
    ]
    cx, cy, cz = (math.cos(value) for value in rotations)
    sx, sy, sz = (math.sin(value) for value in rotations)
    matrix = (
        (cy * cz, cz * sx * sy - cx * sz, sx * sz + cx * cz * sy),
        (cy * sz, cx * cz + sx * sy * sz, cx * sy * sz - cz * sx),
        (-sy, cy * sx, cx * cy),
    )
    return [sum(abs(matrix[row][column]) * sizes[column] for column in range(3)) for row in range(3)]


def _bounds(parts):
    if not parts:
        return {"width": 0, "height": 0, "depth": 0}
    minimum = [float("inf")] * 3
    maximum = [float("-inf")] * 3
    for part in parts:
        position = [_number(part.get("xMm")), _number(part.get("yMm")), _number(part.get("zMm"))]
        extents = _rotated_extents(part)
        for index in range(3):
            minimum[index] = min(minimum[index], position[index] - extents[index] / 2)
            maximum[index] = max(maximum[index], position[index] + extents[index] / 2)
    values = [round(maximum[index] - minimum[index], 3) for index in range(3)]
    return {"width": values[0], "height": values[1], "depth": values[2]}


def migrate_legacy_document(project_data, *, project_id, name):
    if isinstance(project_data, str):
        project_data = json.loads(project_data)
    if project_data.get("schemaVersion") == 2:
        return project_data
    workspace = project_data if isinstance(project_data.get("model"), dict) else {}
    model = workspace.get("model", project_data)
    parts = model.get("parts", [])
    root_id = _entity_uuid(project_id, "assembly", "root")
    id_map = {
        str(part.get("id")): _entity_uuid(project_id, "entity", part.get("id", index))
        for index, part in enumerate(parts)
    }
    panels = []
    hardware = []
    for index, part in enumerate(parts):
        legacy_id = str(part.get("id", index))
        common = {
            "id": str(id_map[legacy_id]),
            "legacyId": part.get("id"),
            "name": part.get("name"),
            "ownerAssemblyId": str(root_id),
            "dimensionsMm": {
                "x": _number(part.get("sizeX")), "y": _number(part.get("sizeY")),
                "z": _number(part.get("sizeZ")),
            },
            "transform": {
                "positionMm": [_number(part.get("xMm")), _number(part.get("yMm")), _number(part.get("zMm"))],
                "rotationDeg": [_number(part.get("rotationX")), _number(part.get("rotationY")), _number(part.get("rotationZ"))],
            },
            "attachedToEntityId": str(id_map[str(part["attachedTo"])]) if str(part.get("attachedTo")) in id_map else None,
            "lockedToEntityId": str(id_map[str(part["lockedTo"])]) if str(part.get("lockedTo")) in id_map else None,
            "legacyGroupId": part.get("groupId"),
            "legacyData": part,
        }
        if part.get("kind") == "hardware":
            hardware.append({**common, "entityType": "hardware-instance", "hardwareType": part.get("hardwareType", "unknown"), "catalogProductVersionId": None})
        else:
            panels.append({**common, "entityType": "panel", "panelType": part.get("partType"), "materialRef": {"legacyCode": part.get("material", "ldsp-16")}, "faceSide": part.get("faceSide"), "frontDirection": part.get("frontDirection")})
    connections = []
    for index, connection in enumerate(model.get("connections", [])):
        connections.append({
            "id": str(_entity_uuid(project_id, "connection", connection.get("id", index))),
            "legacyId": connection.get("id"), "entityType": "connection",
            "connectionType": connection.get("type"),
            "entityIds": [str(id_map[str(item)]) for item in connection.get("partIds", []) if str(item) in id_map],
            "insetMm": connection.get("insetMm"),
            "positionsMm": list(connection.get("positionsMm", [])),
        })
    bounds = _bounds(parts)
    editor_state = {key: value for key, value in workspace.items() if key != "model"}
    return {
        "schemaVersion": 2,
        "documentType": "furniture-definition",
        "rootAssemblyId": str(root_id),
        "metadata": {"name": str(name or "Импортированный элемент"), "componentType": "cabinet", "units": "mm"},
        "entities": {
            "assemblies": [{"id": str(root_id), "entityType": "assembly", "assemblyType": "cabinet", "parentAssemblyId": None}],
            "panels": panels, "facades": [], "hardwareInstances": hardware,
            "connections": connections, "machiningOperations": [],
        },
        "placement": {
            "boundsMm": bounds,
            "origin": {"type": "back-left-bottom", "positionMm": [0, 0, 0]},
            "anchors": [],
            "collisionVolumes": [{"type": "box", "sizeMm": [bounds["width"], bounds["height"], bounds["depth"]]}] if bounds["width"] else [],
        },
        "legacy": {
            "modelState": {
                "nextPartNumber": model.get("nextPartNumber", len(parts) + 1),
                "nextConnectionNumber": model.get("nextConnectionNumber", len(connections) + 1),
                "gridStepMm": model.get("gridStepMm", 1),
            },
            "editorState": editor_state,
        },
    }


async def _already_migrated(target, table, source_id, checksum):
    row = await target.fetch_one(
        "SELECT checksum FROM migrated_records WHERE source_table = $1 AND source_id = $2",
        table, source_id,
    )
    return bool(row and row["checksum"] == checksum)


async def _record(target, table, source_id, target_type, target_id, checksum):
    await target.execute(
        """INSERT INTO migrated_records (source_table, source_id, target_type, target_id, checksum)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (source_table, source_id) DO UPDATE
           SET target_type = EXCLUDED.target_type, target_id = EXCLUDED.target_id,
               checksum = EXCLUDED.checksum, migrated_at = NOW()""",
        table, source_id, target_type, target_id, checksum,
    )


async def _migrate_kitchen(target, row):
    await target.execute(
        """INSERT INTO kitchen_projects (id, user_id, name, room_data, scene_data, created_at, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, room_data = EXCLUDED.room_data,
             scene_data = EXCLUDED.scene_data, updated_at = EXCLUDED.updated_at
           WHERE kitchen_projects.user_id = EXCLUDED.user_id""",
        row["id"], row["user_id"], row["name"], _json(row.get("room_data") or {}),
        _json(row.get("scene_data") or {"placements": []}), row["created_at"], row["updated_at"],
    )


async def _migrate_project(target, row):
    project_id = row["id"]
    revision_id = uuid.uuid5(MIGRATION_NAMESPACE, f"legacy-project:{project_id}:revision:1")
    document = migrate_legacy_document(row["project_data"], project_id=project_id, name=row["name"])
    await target.execute(
        """INSERT INTO furniture_definitions
             (id, user_id, kitchen_project_id, name, component_type, scope, autosaved,
              latest_revision_id, legacy_project_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'cabinet', $5, $6, NULL, $1, $7, $8)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, autosaved = EXCLUDED.autosaved,
             kitchen_project_id = EXCLUDED.kitchen_project_id, updated_at = EXCLUDED.updated_at
           WHERE furniture_definitions.user_id = EXCLUDED.user_id""",
        project_id, row["user_id"], row.get("kitchen_project_id"), row["name"],
        "kitchen-project" if row.get("kitchen_project_id") else "library",
        bool(row.get("autosaved")), row["created_at"], row["updated_at"],
    )
    await target.execute(
        """INSERT INTO furniture_revisions
             (id, definition_id, revision_number, schema_version, document, placement_metadata,
              created_by, created_at)
           VALUES ($1, $2, 1, 2, $3::jsonb, $4::jsonb, $5, $6)
           ON CONFLICT (id) DO NOTHING""",
        revision_id, project_id, _json(document), _json(document["placement"]),
        row["user_id"], row["created_at"],
    )
    await target.execute(
        "UPDATE furniture_definitions SET latest_revision_id = $2 WHERE id = $1 AND user_id = $3",
        project_id, revision_id, row["user_id"],
    )
    return revision_id


async def _migrate_instances(target, kitchens, projects, revision_ids):
    project_by_id = {str(row["id"]): row for row in projects}
    for kitchen in kitchens:
        scene = kitchen.get("scene_data") or {}
        if isinstance(scene, str):
            scene = json.loads(scene)
        for index, placement in enumerate(scene.get("placements", [])):
            project_id = str(placement.get("furnitureProjectId") or placement.get("definitionId") or "")
            project = project_by_id.get(project_id)
            if not project:
                continue
            instance_id = _uuid(placement.get("id"), f"{kitchen['id']}:placement:{index}")
            transform = {
                "positionMm": [_number(placement.get("xMm")), _number(placement.get("yMm")), _number(placement.get("zMm"))],
                "rotationDeg": [_number(placement.get("rotationX")), _number(placement.get("rotationY")), _number(placement.get("rotationZ", placement.get("rotationY", 0)))],
                "scale": placement.get("scale", [1, 1, 1]),
            }
            await target.execute(
                """INSERT INTO furniture_instances
                     (id, user_id, kitchen_project_id, definition_id, revision_id, transform, placement,
                      created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $8)
                   ON CONFLICT (id) DO NOTHING""",
                instance_id, kitchen["user_id"], kitchen["id"], project["id"],
                revision_ids[str(project["id"])], _json(transform), _json(placement), kitchen["updated_at"],
            )


async def _migrate_library(target, row, project_by_id, revision_ids):
    source_id = row.get("source_project_id")
    source_project = project_by_id.get(str(source_id)) if source_id else None
    if source_project:
        definition_id = source_project["id"]
    else:
        definition_id = uuid.uuid5(MIGRATION_NAMESPACE, f"legacy-library:{row['id']}:definition")
        synthetic = {
            "id": definition_id, "user_id": row["user_id"], "name": row["name"],
            "kitchen_project_id": None, "project_data": row["item_data"], "autosaved": False,
            "created_at": row["created_at"], "updated_at": row["updated_at"],
        }
        revision_ids[str(definition_id)] = await _migrate_project(target, synthetic)
    await target.execute(
        """INSERT INTO furniture_library_entries
             (id, user_id, definition_id, name, legacy_item_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $1, $5, $6)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at
           WHERE furniture_library_entries.user_id = EXCLUDED.user_id""",
        row["id"], row["user_id"], definition_id, row["name"], row["created_at"], row["updated_at"],
    )
    return definition_id


async def _read_source(source, source_project_id=None):
    if source_project_id:
        project_id = uuid.UUID(str(source_project_id))
        projects = [dict(row) for row in await source.fetch_all(
            "SELECT * FROM furniture_projects WHERE id = $1", project_id
        )]
        kitchen_ids = [row.get("kitchen_project_id") for row in projects if row.get("kitchen_project_id")]
        kitchens = [dict(row) for row in await source.fetch_all(
            "SELECT * FROM kitchen_projects WHERE id = ANY($1::uuid[])", kitchen_ids
        )] if kitchen_ids else []
        library = [dict(row) for row in await source.fetch_all(
            "SELECT * FROM furniture_library_items WHERE source_project_id = $1", project_id
        )]
        return kitchens, projects, library
    return (
        [dict(row) for row in await source.fetch_all("SELECT * FROM kitchen_projects")],
        [dict(row) for row in await source.fetch_all("SELECT * FROM furniture_projects")],
        [dict(row) for row in await source.fetch_all("SELECT * FROM furniture_library_items")],
    )


async def verify_legacy(source, target, *, source_project_id=None):
    kitchens, projects, library = await _read_source(source, source_project_id)
    records = (
        [("kitchen_projects", row) for row in kitchens]
        + [("furniture_projects", row) for row in projects]
        + [("furniture_library_items", row) for row in library]
    )
    result = {"expected": len(records), "matched": 0, "missing": [], "changed": []}
    for table, row in records:
        migrated = await target.fetch_one(
            "SELECT checksum FROM migrated_records WHERE source_table = $1 AND source_id = $2",
            table, row["id"],
        )
        if not migrated:
            result["missing"].append({"table": table, "id": str(row["id"])})
        elif migrated["checksum"] != _checksum(row):
            result["changed"].append({"table": table, "id": str(row["id"])})
        else:
            result["matched"] += 1
    result["valid"] = result["matched"] == result["expected"]
    return result


async def migrate_legacy(source, target, *, source_fingerprint, dry_run=False, source_project_id=None):
    kitchens, projects, library = await _read_source(source, source_project_id)
    report = MigrationReport(planned=len(kitchens) + len(projects) + len(library))
    if dry_run:
        return report

    run_id = uuid.uuid4()
    await target.execute(
        "INSERT INTO migration_runs (id, source_fingerprint, status) VALUES ($1, $2, 'running')",
        run_id, source_fingerprint,
    )
    try:
        revision_ids = {}
        project_by_id = {str(row["id"]): row for row in projects}
        for table, target_type, rows, handler in (
            ("kitchen_projects", "kitchen-project", kitchens, _migrate_kitchen),
            ("furniture_projects", "furniture-definition", projects, _migrate_project),
        ):
            for row in rows:
                checksum = _checksum(row)
                unchanged = await _already_migrated(target, table, row["id"], checksum)
                if unchanged:
                    report.unchanged += 1
                    if table == "furniture_projects":
                        current = await target.fetch_one("SELECT latest_revision_id FROM furniture_definitions WHERE id = $1", row["id"])
                        revision_ids[str(row["id"])] = current["latest_revision_id"]
                    continue
                result = await handler(target, row)
                if table == "furniture_projects":
                    revision_ids[str(row["id"])] = result
                await _record(target, table, row["id"], target_type, row["id"], checksum)
                report.inserted += 1
        await _migrate_instances(target, kitchens, projects, revision_ids)
        for row in library:
            checksum = _checksum(row)
            if await _already_migrated(target, "furniture_library_items", row["id"], checksum):
                report.unchanged += 1
                continue
            target_id = await _migrate_library(target, row, project_by_id, revision_ids)
            await _record(target, "furniture_library_items", row["id"], "library-entry", row["id"], checksum)
            report.inserted += 1
        await target.execute(
            "UPDATE migration_runs SET status = 'complete', report = $2::jsonb, finished_at = NOW() WHERE id = $1",
            run_id, _json(report.as_dict()),
        )
        return report
    except Exception:
        report.failed += 1
        await target.execute(
            "UPDATE migration_runs SET status = 'failed', report = $2::jsonb, finished_at = NOW() WHERE id = $1",
            run_id, _json(report.as_dict()),
        )
        raise
