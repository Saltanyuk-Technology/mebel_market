const EPSILON = 1e-7;

function orientation(a, b, c) {
  return (b.xMm - a.xMm) * (c.zMm - a.zMm) - (b.zMm - a.zMm) * (c.xMm - a.xMm);
}

function onSegment(a, b, c) {
  return b.xMm >= Math.min(a.xMm, c.xMm) - EPSILON
    && b.xMm <= Math.max(a.xMm, c.xMm) + EPSILON
    && b.zMm >= Math.min(a.zMm, c.zMm) - EPSILON
    && b.zMm <= Math.max(a.zMm, c.zMm) + EPSILON;
}

export function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON))
    && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) {
    return true;
  }

  if (Math.abs(o1) <= EPSILON && onSegment(a, c, b)) return true;
  if (Math.abs(o2) <= EPSILON && onSegment(a, d, b)) return true;
  if (Math.abs(o3) <= EPSILON && onSegment(c, a, d)) return true;
  if (Math.abs(o4) <= EPSILON && onSegment(c, b, d)) return true;
  return false;
}

export function wouldIntersectExisting(room, startPoint, endPoint, closing = false) {
  for (let index = 0; index < room.walls.length; index += 1) {
    const wall = room.walls[index];
    const a = room.getPoint(wall.startPointId);
    const b = room.getPoint(wall.endPointId);
    const sharesStart = a.id === startPoint.id || b.id === startPoint.id;
    const sharesEnd = a.id === endPoint.id || b.id === endPoint.id;
    if (sharesStart || sharesEnd) continue;
    if (segmentsIntersect(startPoint, endPoint, a, b)) return true;
  }

  if (closing && room.walls.length > 1) {
    const firstWall = room.walls[0];
    const lastWall = room.walls.at(-1);
    if (firstWall.id === lastWall.id) return false;
  }
  return false;
}

export function polygonSelfIntersects(points) {
  if (points.length < 4) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      const c = points[j];
      const d = points[(j + 1) % points.length];
      const adjacent = i === j || (i + 1) % points.length === j || i === (j + 1) % points.length;
      if (!adjacent && segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

export function wallFootprint(room, wall) {
  const points = room.getWallPoints(wall);
  if (!points) return null;
  const dx = points.end.xMm - points.start.xMm;
  const dz = points.end.zMm - points.start.zMm;
  const length = Math.hypot(dx, dz);
  if (length < EPSILON) return null;
  const thickness = room.getWallThickness(wall);
  const offsetX = (-dz / length) * thickness;
  const offsetZ = (dx / length) * thickness;
  return [
    { xMm: points.start.xMm, zMm: points.start.zMm },
    { xMm: points.end.xMm, zMm: points.end.zMm },
    { xMm: points.end.xMm + offsetX, zMm: points.end.zMm + offsetZ },
    { xMm: points.start.xMm + offsetX, zMm: points.start.zMm + offsetZ },
  ];
}

export function findWallCornerSnap(room, movingWallIds, dxMm, dzMm, thresholdMm = 180) {
  const movingIds = new Set(movingWallIds);
  const movingWalls = room.walls.filter((wall) => movingIds.has(wall.id));
  const movingPointIds = new Set(movingWalls.flatMap((wall) => [wall.startPointId, wall.endPointId]));
  const stationaryWalls = room.walls.filter((wall) => (
    !movingIds.has(wall.id)
    && !movingPointIds.has(wall.startPointId)
    && !movingPointIds.has(wall.endPointId)
  ));
  let best = null;

  movingWalls.forEach((movingWall) => {
    const movingCorners = wallFootprint(room, movingWall) ?? [];
    stationaryWalls.forEach((stationaryWall) => {
      const targetCorners = wallFootprint(room, stationaryWall) ?? [];
      movingCorners.forEach((corner) => {
        const candidateX = corner.xMm + dxMm;
        const candidateZ = corner.zMm + dzMm;
        targetCorners.forEach((target) => {
          const distance = Math.hypot(target.xMm - candidateX, target.zMm - candidateZ);
          if (distance <= thresholdMm && (!best || distance < best.distanceMm)) {
            best = {
              dxMm: dxMm + target.xMm - candidateX,
              dzMm: dzMm + target.zMm - candidateZ,
              distanceMm: distance,
              targetWallId: stationaryWall.id,
            };
          }
        });
      });
    });
  });

  return best;
}

function projection(polygon, axis) {
  const values = polygon.map((point) => point.xMm * axis.x + point.zMm * axis.z);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function polygonsOverlap(a, b) {
  for (const polygon of [a, b]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      const axis = { x: -(end.zMm - start.zMm), z: end.xMm - start.xMm };
      const length = Math.hypot(axis.x, axis.z);
      if (length < EPSILON) continue;
      axis.x /= length;
      axis.z /= length;
      const first = projection(a, axis);
      const second = projection(b, axis);
      // Zero overlap means the wall faces only touch, which is allowed.
      if (Math.min(first.max, second.max) - Math.max(first.min, second.min) <= EPSILON) return false;
    }
  }
  return true;
}

function pointInsideConvexPolygon(point, polygon) {
  return polygon.every((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return orientation(start, end, point) >= -EPSILON;
  });
}

function distanceToSegment(point, start, end) {
  const dx = end.xMm - start.xMm;
  const dz = end.zMm - start.zMm;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= EPSILON) return Math.hypot(point.xMm - start.xMm, point.zMm - start.zMm);
  const factor = Math.max(0, Math.min(1, (
    (point.xMm - start.xMm) * dx + (point.zMm - start.zMm) * dz
  ) / lengthSquared));
  return Math.hypot(
    point.xMm - (start.xMm + dx * factor),
    point.zMm - (start.zMm + dz * factor),
  );
}

function distanceToPolygon(point, polygon) {
  if (pointInsideConvexPolygon(point, polygon)) return 0;
  return Math.min(...polygon.map((start, index) => (
    distanceToSegment(point, start, polygon[(index + 1) % polygon.length])
  )));
}

export function wallsOverlap(room, firstWallOrId, secondWallOrId) {
  const first = typeof firstWallOrId === "string" ? room.getWall(firstWallOrId) : firstWallOrId;
  const second = typeof secondWallOrId === "string" ? room.getWall(secondWallOrId) : secondWallOrId;
  if (!first || !second || first.id === second.id) return false;
  const sharesPoint = first.startPointId === second.startPointId
    || first.startPointId === second.endPointId
    || first.endPointId === second.startPointId
    || first.endPointId === second.endPointId;
  if (sharesPoint) return false;
  const firstFootprint = wallFootprint(room, first);
  const secondFootprint = wallFootprint(room, second);
  return Boolean(firstFootprint && secondFootprint && polygonsOverlap(firstFootprint, secondFootprint));
}

export function wallOverlapsAny(room, wallOrId) {
  const wall = typeof wallOrId === "string" ? room.getWall(wallOrId) : wallOrId;
  return Boolean(wall && room.walls.some((other) => wallsOverlap(room, wall, other)));
}

function segmentPolygonInterval(origin, axis, length, polygon) {
  let min = 0;
  let max = length;
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    const edgeX = edgeEnd.xMm - edgeStart.xMm;
    const edgeZ = edgeEnd.zMm - edgeStart.zMm;
    const offsetX = origin.xMm - edgeStart.xMm;
    const offsetZ = origin.zMm - edgeStart.zMm;
    const constant = edgeX * offsetZ - edgeZ * offsetX;
    const factor = edgeX * axis.z - edgeZ * axis.x;
    if (Math.abs(factor) <= EPSILON) {
      if (constant < -EPSILON) return null;
      continue;
    }
    const boundary = -constant / factor;
    if (factor > 0) min = Math.max(min, boundary);
    else max = Math.min(max, boundary);
    if (max < min - EPSILON) return null;
  }
  return { min: Math.max(0, min), max: Math.min(length, max) };
}

export function getWallDimensionSpan(room, wallOrId, surfaceOffsetMm = null) {
  const wall = typeof wallOrId === "string" ? room.getWall(wallOrId) : wallOrId;
  const points = room.getWallPoints(wall);
  if (!wall || !points) return null;
  const dx = points.end.xMm - points.start.xMm;
  const dz = points.end.zMm - points.start.zMm;
  const length = Math.hypot(dx, dz);
  if (length < EPSILON) return null;
  const axis = { x: dx / length, z: dz / length };
  const normal = { x: -axis.z, z: axis.x };
  const measurementOffset = room.getWallThickness(wall) / 2;
  const measurementOrigin = {
    xMm: points.start.xMm + normal.x * measurementOffset,
    zMm: points.start.zMm + normal.z * measurementOffset,
  };
  const displayOffset = surfaceOffsetMm ?? measurementOffset;
  const displayOrigin = {
    xMm: points.start.xMm + normal.x * displayOffset,
    zMm: points.start.zMm + normal.z * displayOffset,
  };
  let startInset = 0;
  let endInset = 0;

  room.walls.forEach((other) => {
    if (other.id === wall.id) return;
    const otherPoints = room.getWallPoints(other);
    const footprint = wallFootprint(room, other);
    if (!footprint) return;
    const near = (first, second) => Math.hypot(first.xMm - second.xMm, first.zMm - second.zMm) <= 1;
    const touchesStart = distanceToPolygon(points.start, footprint) <= 2;
    const touchesEnd = distanceToPolygon(points.end, footprint) <= 2;
    const sharesStart = other.startPointId === wall.startPointId
      || other.endPointId === wall.startPointId
      || near(points.start, otherPoints.start)
      || near(points.start, otherPoints.end)
      || touchesStart;
    const sharesEnd = other.startPointId === wall.endPointId
      || other.endPointId === wall.endPointId
      || near(points.end, otherPoints.start)
      || near(points.end, otherPoints.end)
      || touchesEnd;
    if (!sharesStart && !sharesEnd) return;
    const interval = segmentPolygonInterval(measurementOrigin, axis, length, footprint);
    if (interval) {
      if (sharesStart && interval.min <= EPSILON) startInset = Math.max(startInset, interval.max);
      if (sharesEnd && interval.max >= length - EPSILON) endInset = Math.max(endInset, length - interval.min);
    }
    const otherDx = otherPoints.end.xMm - otherPoints.start.xMm;
    const otherDz = otherPoints.end.zMm - otherPoints.start.zMm;
    const otherLength = Math.hypot(otherDx, otherDz);
    if (otherLength <= EPSILON) return;
    const otherNormal = { x: -otherDz / otherLength, z: otherDx / otherLength };
    const crossingFactor = Math.abs(axis.x * otherNormal.x + axis.z * otherNormal.z);
    if (crossingFactor <= 0.15) return;
    const cornerInset = Math.min(length, room.getWallThickness(other) / crossingFactor);
    if (sharesStart) startInset = Math.max(startInset, cornerInset);
    if (sharesEnd) endInset = Math.max(endInset, cornerInset);
  });

  const startDistance = Math.min(startInset, length);
  const endDistance = Math.max(startDistance, length - endInset);
  return {
    start: {
      xMm: displayOrigin.xMm + axis.x * startDistance,
      zMm: displayOrigin.zMm + axis.z * startDistance,
    },
    end: {
      xMm: displayOrigin.xMm + axis.x * endDistance,
      zMm: displayOrigin.zMm + axis.z * endDistance,
    },
    startInsetMm: startDistance,
    endInsetMm: length - endDistance,
    lengthMm: Math.max(0, endDistance - startDistance),
  };
}

export function getCameraFacingWallSurface(room, wallOrId, cameraPoint) {
  const wall = typeof wallOrId === "string" ? room.getWall(wallOrId) : wallOrId;
  const points = room.getWallPoints(wall);
  if (!wall || !points) return null;
  const dx = points.end.xMm - points.start.xMm;
  const dz = points.end.zMm - points.start.zMm;
  const length = Math.hypot(dx, dz);
  if (length < EPSILON) return null;
  const axis = { x: dx / length, z: dz / length };
  const normal = { x: -axis.z, z: axis.x };
  const center = {
    xMm: (points.start.xMm + points.end.xMm) / 2,
    zMm: (points.start.zMm + points.end.zMm) / 2,
  };
  const normalSide = (cameraPoint.xMm - center.xMm) * normal.x
    + (cameraPoint.zMm - center.zMm) * normal.z;
  const axisSide = (cameraPoint.xMm - center.xMm) * axis.x
    + (cameraPoint.zMm - center.zMm) * axis.z;
  const outwardSign = normalSide >= 0 ? 1 : -1;
  return {
    axis,
    normal,
    axisSide,
    faceOffsetMm: outwardSign > 0 ? room.getWallThickness(wall) : 0,
    overlayOffsetMm: outwardSign * 3,
  };
}

export function isWallPositiveFaceVisible(room, wallOrId, cameraPoint) {
  const wall = typeof wallOrId === "string" ? room.getWall(wallOrId) : wallOrId;
  if (!wall) return false;
  const points = room.getWallPoints(wall);
  if (!points) return false;
  const dx = points.end.xMm - points.start.xMm;
  const dz = points.end.zMm - points.start.zMm;
  const length = Math.hypot(dx, dz);
  if (length < EPSILON) return false;
  const normal = { x: -dz / length, z: dx / length };
  const faceCenter = {
    xMm: (points.start.xMm + points.end.xMm) / 2 + normal.x * room.getWallThickness(wall),
    zMm: (points.start.zMm + points.end.zMm) / 2 + normal.z * room.getWallThickness(wall),
  };
  return (cameraPoint.xMm - faceCenter.xMm) * normal.x
    + (cameraPoint.zMm - faceCenter.zMm) * normal.z > 0;
}

export function findFreeWallCenter(room, preferredCenter, {
  lengthMm = 3000,
  thicknessMm = room.gridStepMm * 2,
  maxRings = 16,
} = {}) {
  const grid = Math.max(1, room.gridStepMm);
  const searchStep = Math.max(500, thicknessMm + grid);
  const snap = (value) => Math.round(value / grid) * grid;
  const base = {
    xMm: snap(preferredCenter.xMm),
    zMm: snap(preferredCenter.zMm),
  };
  const isFree = (center) => {
    const halfLength = lengthMm / 2;
    const footprint = [
      { xMm: center.xMm - halfLength, zMm: center.zMm },
      { xMm: center.xMm + halfLength, zMm: center.zMm },
      { xMm: center.xMm + halfLength, zMm: center.zMm + thicknessMm },
      { xMm: center.xMm - halfLength, zMm: center.zMm + thicknessMm },
    ];
    return room.walls.every((wall) => {
      const existing = wallFootprint(room, wall);
      return !existing || !polygonsOverlap(footprint, existing);
    });
  };

  for (let ring = 0; ring <= maxRings; ring += 1) {
    for (let zIndex = -ring; zIndex <= ring; zIndex += 1) {
      for (let xIndex = -ring; xIndex <= ring; xIndex += 1) {
        if (Math.max(Math.abs(xIndex), Math.abs(zIndex)) !== ring) continue;
        const candidate = {
          xMm: snap(base.xMm + xIndex * searchStep),
          zMm: snap(base.zMm + zIndex * searchStep),
        };
        if (isFree(candidate)) return candidate;
      }
    }
  }
  return null;
}
