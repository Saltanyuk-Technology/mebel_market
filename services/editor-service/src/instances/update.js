import { boxesOverlap, instanceBox, outsideRoom, revisionBounds } from "./placement.js";

export function previewRevisionUpdate({ instance, currentRevision, nextRevision, room, neighbors = [] }) {
  const violations = [];
  const currentBounds = revisionBounds(currentRevision);
  const nextBounds = revisionBounds(nextRevision);
  const nextTransform = structuredClone(instance.transform ?? { positionMm: [0, 0, 0] });
  const anchor = instance.placement?.anchor ?? "back-left-bottom";
  const position = [...(nextTransform.positionMm ?? [0, 0, 0])];

  if (anchor === "back-right-bottom") position[0] += currentBounds.width - nextBounds.width;
  if (anchor === "front-left-bottom") position[2] += currentBounds.depth - nextBounds.depth;
  if (anchor === "front-right-bottom") {
    position[0] += currentBounds.width - nextBounds.width;
    position[2] += currentBounds.depth - nextBounds.depth;
  }
  nextTransform.positionMm = position;
  const candidate = instanceBox({ ...instance, transform: nextTransform }, nextBounds);
  if (outsideRoom(candidate, room)) {
    violations.push({ code: "OUTSIDE_ROOM", severity: "error", instanceId: instance.id });
  }
  for (const neighbor of neighbors) {
    if (neighbor.id === instance.id) continue;
    const bounds = neighbor.boundsMm ?? revisionBounds(neighbor.revision);
    if (boxesOverlap(candidate, instanceBox(neighbor, bounds))) {
      violations.push({ code: "INSTANCE_COLLISION", severity: "error", instanceId: instance.id, neighborId: neighbor.id });
    }
  }
  return {
    valid: violations.length === 0,
    violations,
    currentRevisionId: currentRevision?.id ?? instance.revisionId,
    nextRevisionId: nextRevision?.id,
    currentBounds,
    nextBounds,
    nextTransform,
  };
}
