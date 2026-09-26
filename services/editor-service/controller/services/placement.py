import copy
import json


def _decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def revision_bounds(revision):
    document = _decoded(revision.get("document")) or {}
    metadata = _decoded(revision.get("placement_metadata")) or {}
    bounds = document.get("placement", {}).get("boundsMm") or metadata.get("boundsMm") or metadata
    return {
        "width": bounds.get("width", bounds.get("widthMm", 0)),
        "height": bounds.get("height", bounds.get("heightMm", 0)),
        "depth": bounds.get("depth", bounds.get("depthMm", 0)),
    }


def _box(transform, bounds):
    position = (_decoded(transform) or {}).get("positionMm", [0, 0, 0])
    x, y, z = (position + [0, 0, 0])[:3]
    return (x, x + bounds["width"], y, y + bounds["height"], z, z + bounds["depth"])


def _overlaps(left, right):
    return left[0] < right[1] and left[1] > right[0] and left[2] < right[3] and left[3] > right[2] and left[4] < right[5] and left[5] > right[4]


def preview_update(instance, current_revision, next_revision, neighbors, room_data=None):
    transform = copy.deepcopy(_decoded(instance["transform"]) or {"positionMm": [0, 0, 0]})
    placement = _decoded(instance.get("placement")) or {}
    current = revision_bounds(current_revision)
    following = revision_bounds(next_revision)
    position = list(transform.get("positionMm", [0, 0, 0]))
    anchor = placement.get("anchor", "back-left-bottom")
    if "right" in anchor:
        position[0] += current["width"] - following["width"]
    if "front" in anchor:
        position[2] += current["depth"] - following["depth"]
    transform["positionMm"] = position
    candidate = _box(transform, following)
    violations = []
    room = _decoded(room_data) or {}
    room_bounds = room.get("boundsMm")
    if room_bounds and (candidate[0] < 0 or candidate[2] < 0 or candidate[4] < 0 or candidate[1] > room_bounds.get("width", float("inf")) or candidate[5] > room_bounds.get("depth", float("inf"))):
        violations.append({"code": "OUTSIDE_ROOM", "severity": "error", "instanceId": str(instance["id"])})
    for neighbor in neighbors:
        if neighbor["id"] == instance["id"]:
            continue
        if _overlaps(candidate, _box(neighbor["transform"], revision_bounds(neighbor))):
            violations.append({"code": "INSTANCE_COLLISION", "severity": "error", "instanceId": str(instance["id"]), "neighborId": str(neighbor["id"])})
    return {
        "valid": not violations, "violations": violations, "nextTransform": transform,
        "currentRevisionId": str(current_revision["id"]), "nextRevisionId": str(next_revision["id"]),
        "currentBounds": current, "nextBounds": following,
    }
