function number(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function revisionBounds(revision) {
  const bounds = revision?.document?.placement?.boundsMm
    ?? revision?.placementMetadata?.boundsMm
    ?? revision?.placementMetadata
    ?? {};
  return {
    width: number(bounds.width, number(bounds.widthMm)),
    height: number(bounds.height, number(bounds.heightMm)),
    depth: number(bounds.depth, number(bounds.depthMm)),
  };
}

export function instanceBox(instance, bounds) {
  const [x = 0, y = 0, z = 0] = instance?.transform?.positionMm ?? [];
  return { minX: x, maxX: x + bounds.width, minY: y, maxY: y + bounds.height, minZ: z, maxZ: z + bounds.depth };
}

export function boxesOverlap(left, right) {
  return left.minX < right.maxX && left.maxX > right.minX
    && left.minY < right.maxY && left.maxY > right.minY
    && left.minZ < right.maxZ && left.maxZ > right.minZ;
}

export function outsideRoom(box, room) {
  const bounds = room?.boundsMm;
  if (!bounds) return false;
  return box.minX < 0 || box.minZ < 0 || box.minY < 0
    || box.maxX > number(bounds.width) || box.maxZ > number(bounds.depth)
    || (number(bounds.height) > 0 && box.maxY > number(bounds.height));
}
