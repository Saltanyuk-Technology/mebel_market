import { distanceMm } from "../core/units.js";
import { getWallDimensionSpan, wallOverlapsAny, wallsOverlap } from "../geometry/polygon.js";

const WINDOW_GAP_MM = 100;

export class RoomModel {
  constructor() {
    this.wallHeightMm = 2700;
    this.gridStepMm = 100;
    this.wallThicknessMm = this.gridStepMm * 2;
    this.snapEnabled = true;
    this.isClosed = false;
    this.points = [];
    this.walls = [];
    this.windows = [];
    this.nextPointNumber = 1;
    this.nextWallNumber = 1;
    this.nextWindowNumber = 1;
    this.nextGroupNumber = 1;
  }

  reset() {
    this.restore(new RoomModel().toJSON());
  }

  addPoint(xMm, zMm, id = null) {
    const point = {
      id: id ?? `point-${this.nextPointNumber++}`,
      xMm: Math.round(xMm),
      zMm: Math.round(zMm),
    };
    this.points.push(point);
    this.syncCounters();
    return point;
  }

  addWall(startPointId, endPointId, id = null, options = {}) {
    const wall = {
      id: id ?? `wall-${this.nextWallNumber++}`,
      startPointId,
      endPointId,
      heightMm: options.heightMm ?? this.wallHeightMm,
      thicknessMm: options.thicknessMm ?? this.wallThicknessMm,
    };
    this.walls.push(wall);
    if (wallOverlapsAny(this, wall)) {
      this.walls.pop();
      return null;
    }
    this.syncCounters();
    return wall;
  }

  getPoint(id) {
    return this.points.find((point) => point.id === id) ?? null;
  }

  getWall(id) {
    return this.walls.find((wall) => wall.id === id) ?? null;
  }

  addWindow(wallId, options = {}) {
    const wall = this.getWall(wallId);
    if (!wall) return null;
    const kind = options.kind === "door" ? "door" : "window";
    const wallLength = this.getWallLength(wall);
    const wallHeight = this.getWallHeight(wall);
    const widthMm = Math.min(options.widthMm ?? (kind === "door" ? 900 : 1200), Math.max(300, wallLength - 200));
    const sillHeightMm = kind === "door"
      ? 0
      : Math.min(options.sillHeightMm ?? 800, Math.max(0, wallHeight - 500));
    const heightMm = Math.min(options.heightMm ?? (kind === "door" ? 2100 : 1400), Math.max(300, wallHeight - sillHeightMm - 100));
    let offsetMm = this.findAvailableWindowOffset(
      wallId,
      widthMm,
      heightMm,
      sillHeightMm,
      options.offsetMm ?? wallLength / 2,
    );
    if (offsetMm == null) offsetMm = this.makeSpaceForWindow(wallId, widthMm, heightMm, sillHeightMm);
    if (offsetMm == null) return null;
    const windowItem = {
      id: options.id ?? `${kind}-${this.nextWindowNumber++}`,
      kind,
      wallId,
      offsetMm,
      widthMm: Math.round(widthMm),
      heightMm: Math.round(heightMm),
      sillHeightMm: Math.round(sillHeightMm),
    };
    this.windows.push(windowItem);
    this.setWindowProperties(windowItem.id, {});
    this.syncCounters();
    return windowItem;
  }

  getWindow(id) { return this.windows.find((item) => item.id === id) ?? null; }

  getGroupMembers(groupId) {
    if (!groupId) return { walls: [], windows: [] };
    return {
      walls: this.walls.filter((wall) => wall.groupId === groupId),
      windows: this.windows.filter((item) => item.groupId === groupId),
    };
  }

  groupItems(wallIds, windowIds) {
    const walls = wallIds.map((id) => this.getWall(id)).filter(Boolean);
    const windows = windowIds.map((id) => this.getWindow(id)).filter(Boolean);
    if (walls.length + windows.length < 2) return false;
    const groupId = `group-${this.nextGroupNumber++}`;
    walls.forEach((wall) => { wall.groupId = groupId; });
    windows.forEach((item) => { item.groupId = groupId; });
    return true;
  }

  setItemsLocked(wallIds, windowIds, locked) {
    wallIds.forEach((id) => {
      const wall = this.getWall(id);
      if (wall) wall.locked = locked;
    });
    windowIds.forEach((id) => {
      const item = this.getWindow(id);
      if (item) item.locked = locked;
    });
    return true;
  }

  makeSpaceForWindow(wallId, widthMm, heightMm, sillHeightMm) {
    const wallLength = this.getWallLength(wallId);
    const bottom = sillHeightMm;
    const top = sillHeightMm + heightMm;
    const neighbors = this.windows
      .filter((other) => other.wallId === wallId && bottom < other.sillHeightMm + other.heightMm && top > other.sillHeightMm)
      .sort((a, b) => a.offsetMm - b.offsetMm);
    const requiredWidth = neighbors.reduce((sum, other) => sum + other.widthMm, widthMm) + neighbors.length * WINDOW_GAP_MM;
    if (requiredWidth > wallLength) return null;
    let cursor = (wallLength - requiredWidth) / 2;
    neighbors.forEach((other) => {
      other.offsetMm = Math.round(cursor + other.widthMm / 2);
      cursor += other.widthMm + WINDOW_GAP_MM;
    });
    return Math.round(cursor + widthMm / 2);
  }

  findAvailableWindowOffset(wallId, widthMm, heightMm, sillHeightMm, preferredOffsetMm, excludeId = null) {
    const wallLength = this.getWallLength(wallId);
    const halfWidth = widthMm / 2;
    if (wallLength < widthMm) return null;
    const minOffset = halfWidth;
    const maxOffset = wallLength - halfWidth;
    const preferred = Math.max(minOffset, Math.min(preferredOffsetMm, maxOffset));
    const bottom = sillHeightMm;
    const top = sillHeightMm + heightMm;
    const blockers = this.windows.filter((other) => (
      other.wallId === wallId
      && other.id !== excludeId
      && bottom < other.sillHeightMm + other.heightMm
      && top > other.sillHeightMm
    ));
    const candidates = [preferred, minOffset, maxOffset];
    blockers.forEach((other) => {
      const distance = halfWidth + other.widthMm / 2 + WINDOW_GAP_MM;
      candidates.push(other.offsetMm - distance, other.offsetMm + distance);
    });
    const fits = (offset) => offset >= minOffset && offset <= maxOffset && blockers.every((other) => {
      const requiredDistance = halfWidth + other.widthMm / 2 + WINDOW_GAP_MM;
      return Math.abs(offset - other.offsetMm) >= requiredDistance;
    });
    const available = candidates.filter(fits).sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
    return available.length ? Math.round(available[0]) : null;
  }

  setWindowProperties(id, changes) {
    const item = this.getWindow(id);
    if (!item) return;
    const wallId = changes.wallId ?? item.wallId;
    if (!this.getWall(wallId)) return false;
    const wallLength = this.getWallLength(wallId);
    const wallHeight = this.getWallHeight(wallId);
    const requestedWidth = Number.isFinite(changes.widthMm) ? changes.widthMm : item.widthMm;
    if (wallId !== item.wallId && requestedWidth > wallLength - 100) return false;
    const requestedSill = item.kind === "door"
      ? 0
      : Number.isFinite(changes.sillHeightMm) ? changes.sillHeightMm : item.sillHeightMm;
    const requestedHeight = Number.isFinite(changes.heightMm) ? changes.heightMm : item.heightMm;
    const widthMm = Math.round(Math.max(300, Math.min(requestedWidth, wallLength - 100)));
    let sillHeightMm = Math.round(Math.max(0, Math.min(requestedSill, wallHeight - 400)));
    const heightMm = Math.round(Math.max(300, Math.min(requestedHeight, wallHeight - sillHeightMm - 100)));
    sillHeightMm = Math.round(Math.max(0, Math.min(sillHeightMm, wallHeight - heightMm - 100)));
    const half = widthMm / 2;
    const requestedOffset = Number.isFinite(changes.offsetMm) ? changes.offsetMm : item.offsetMm;
    const boundedOffset = Math.max(half, Math.min(requestedOffset, wallLength - half));
    const offsetMm = this.findAvailableWindowOffset(wallId, widthMm, heightMm, sillHeightMm, boundedOffset, item.id);
    if (offsetMm == null) return false;
    item.wallId = wallId;
    item.widthMm = widthMm;
    item.heightMm = heightMm;
    item.sillHeightMm = sillHeightMm;
    item.offsetMm = offsetMm;
    return true;
  }

  deleteWindow(id) { this.windows = this.windows.filter((item) => item.id !== id); }

  getWallPoints(wallOrId) {
    const wall = typeof wallOrId === "string" ? this.getWall(wallOrId) : wallOrId;
    if (!wall) return null;
    return {
      start: this.getPoint(wall.startPointId),
      end: this.getPoint(wall.endPointId),
    };
  }

  getWallLength(wallOrId) {
    const points = this.getWallPoints(wallOrId);
    return points ? distanceMm(points.start, points.end) : 0;
  }

  getWallVisibleLength(wallOrId) {
    return getWallDimensionSpan(this, wallOrId)?.lengthMm ?? this.getWallLength(wallOrId);
  }

  setWallVisibleLength(id, lengthMm) {
    if (!Number.isFinite(lengthMm) || lengthMm <= 0) return false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const currentVisible = this.getWallVisibleLength(id);
      const currentLength = this.getWallLength(id);
      if (Math.abs(currentVisible - lengthMm) < 0.5) return true;
      if (!this.setWallLength(id, currentLength + lengthMm - currentVisible)) return false;
    }
    return Math.abs(this.getWallVisibleLength(id) - lengthMm) < 1;
  }

  getWallHeight(wallOrId) {
    const wall = typeof wallOrId === "string" ? this.getWall(wallOrId) : wallOrId;
    return wall?.heightMm ?? this.wallHeightMm;
  }

  getWallThickness(wallOrId) {
    const wall = typeof wallOrId === "string" ? this.getWall(wallOrId) : wallOrId;
    return wall?.thicknessMm ?? this.wallThicknessMm;
  }

  getWallAngleDeg(wallOrId) {
    const points = this.getWallPoints(wallOrId);
    if (!points) return 0;
    return Math.round((Math.atan2(points.end.zMm - points.start.zMm, points.end.xMm - points.start.xMm) * 180) / Math.PI);
  }

  getOrderedContourPoints() {
    if (!this.walls.length) return [];
    const result = [this.getPoint(this.walls[0].startPointId)];
    this.walls.forEach((wall) => result.push(this.getPoint(wall.endPointId)));
    if (this.isClosed && result.at(-1)?.id === result[0]?.id) result.pop();
    return result.filter(Boolean);
  }

  movePoint(id, xMm, zMm) {
    const point = this.getPoint(id);
    if (!point) return false;
    const previous = { xMm: point.xMm, zMm: point.zMm };
    const affectedWalls = this.walls.filter((wall) => wall.startPointId === id || wall.endPointId === id);
    point.xMm = Math.round(xMm);
    point.zMm = Math.round(zMm);
    if (affectedWalls.some((wall) => wallOverlapsAny(this, wall))) {
      point.xMm = previous.xMm;
      point.zMm = previous.zMm;
      return false;
    }
    return true;
  }

  setWallPoints(id, start, end) {
    const wall = this.getWall(id);
    const points = this.getWallPoints(wall);
    if (!wall || !points) return false;
    const previous = {
      start: { xMm: points.start.xMm, zMm: points.start.zMm },
      end: { xMm: points.end.xMm, zMm: points.end.zMm },
    };
    points.start.xMm = Math.round(start.xMm);
    points.start.zMm = Math.round(start.zMm);
    points.end.xMm = Math.round(end.xMm);
    points.end.zMm = Math.round(end.zMm);
    const pointIds = new Set([wall.startPointId, wall.endPointId]);
    const affectedWalls = this.walls.filter((item) => pointIds.has(item.startPointId) || pointIds.has(item.endPointId));
    if (affectedWalls.some((item) => wallOverlapsAny(this, item))) {
      Object.assign(points.start, previous.start);
      Object.assign(points.end, previous.end);
      return false;
    }
    return true;
  }

  setWallLength(id, lengthMm) {
    const points = this.getWallPoints(id);
    if (!points || lengthMm <= 0) return false;
    const dx = points.end.xMm - points.start.xMm;
    const dz = points.end.zMm - points.start.zMm;
    const currentLength = Math.hypot(dx, dz);
    if (currentLength < 1) return false;
    return this.setWallPoints(id, points.start, {
      xMm: points.start.xMm + (dx / currentLength) * lengthMm,
      zMm: points.start.zMm + (dz / currentLength) * lengthMm,
    });
  }

  setWallAngle(id, angleDeg) {
    const points = this.getWallPoints(id);
    if (!points || !Number.isFinite(angleDeg)) return false;
    const length = this.getWallLength(id);
    const centerX = (points.start.xMm + points.end.xMm) / 2;
    const centerZ = (points.start.zMm + points.end.zMm) / 2;
    const angle = (angleDeg * Math.PI) / 180;
    const halfX = (Math.cos(angle) * length) / 2;
    const halfZ = (Math.sin(angle) * length) / 2;
    return this.setWallPoints(
      id,
      { xMm: centerX - halfX, zMm: centerZ - halfZ },
      { xMm: centerX + halfX, zMm: centerZ + halfZ },
    );
  }

  moveWall(id, dxMm, dzMm) {
    const points = this.getWallPoints(id);
    if (!points) return false;
    return this.setWallPoints(
      id,
      { xMm: points.start.xMm + dxMm, zMm: points.start.zMm + dzMm },
      { xMm: points.end.xMm + dxMm, zMm: points.end.zMm + dzMm },
    );
  }

  moveWallClamped(id, dxMm, dzMm) {
    const points = this.getWallPoints(id);
    if (!points) return false;
    const origin = {
      start: { xMm: points.start.xMm, zMm: points.start.zMm },
      end: { xMm: points.end.xMm, zMm: points.end.zMm },
    };
    const candidateAt = (factor) => this.setWallPoints(
      id,
      {
        xMm: origin.start.xMm + dxMm * factor,
        zMm: origin.start.zMm + dzMm * factor,
      },
      {
        xMm: origin.end.xMm + dxMm * factor,
        zMm: origin.end.zMm + dzMm * factor,
      },
    );
    if (candidateAt(1)) return true;

    let allowed = 0;
    let blocked = 1;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const factor = (allowed + blocked) / 2;
      if (candidateAt(factor)) allowed = factor;
      else blocked = factor;
    }
    candidateAt(allowed);
    const movedPoints = this.getWallPoints(id);
    return movedPoints.start.xMm !== origin.start.xMm || movedPoints.start.zMm !== origin.start.zMm;
  }

  moveWallGroupClamped(id, dxMm, dzMm) {
    const wall = this.getWall(id);
    if (!wall) return false;
    const movingWalls = wall.groupId ? this.getGroupMembers(wall.groupId).walls : [wall];
    if (movingWalls.some((item) => item.locked)) return false;
    const movingIds = new Set(movingWalls.map((item) => item.id));
    const pointIds = new Set(movingWalls.flatMap((item) => [item.startPointId, item.endPointId]));
    const connectedWalls = this.walls.filter((item) => (
      !movingIds.has(item.id)
      && (pointIds.has(item.startPointId) || pointIds.has(item.endPointId))
    ));
    let moveX = dxMm;
    let moveZ = dzMm;
    if (connectedWalls.length) {
      const connectedAxes = connectedWalls.map((item) => {
        const points = this.getWallPoints(item);
        const axisX = points.end.xMm - points.start.xMm;
        const axisZ = points.end.zMm - points.start.zMm;
        const length = Math.hypot(axisX, axisZ);
        return length > 0 ? { x: axisX / length, z: axisZ / length } : null;
      }).filter(Boolean);
      const movementAxis = connectedAxes[0];
      const axesAreParallel = movementAxis && connectedAxes.every((axis) => (
        Math.abs(movementAxis.x * axis.z - movementAxis.z * axis.x) < 1e-4
      ));
      if (!axesAreParallel) return false;
      const axisDistance = dxMm * movementAxis.x + dzMm * movementAxis.z;
      moveX = axisDistance * movementAxis.x;
      moveZ = axisDistance * movementAxis.z;
    }
    const origin = new Map([...pointIds].map((pointId) => {
      const point = this.getPoint(pointId);
      return [pointId, { xMm: point.xMm, zMm: point.zMm }];
    }));
    const candidateAt = (factor) => {
      const previous = new Map([...pointIds].map((pointId) => {
        const point = this.getPoint(pointId);
        return [pointId, { xMm: point.xMm, zMm: point.zMm }];
      }));
      pointIds.forEach((pointId) => {
        const point = this.getPoint(pointId);
        const start = origin.get(pointId);
        point.xMm = Math.round(start.xMm + moveX * factor);
        point.zMm = Math.round(start.zMm + moveZ * factor);
      });
      const blocked = movingWalls.some((moving) => this.walls.some((other) => (
        !movingIds.has(other.id) && wallsOverlap(this, moving, other)
      )));
      if (blocked) {
        previous.forEach((position, pointId) => Object.assign(this.getPoint(pointId), position));
        return false;
      }
      return true;
    };
    if (candidateAt(1)) return true;
    let allowed = 0;
    let blocked = 1;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const factor = (allowed + blocked) / 2;
      if (candidateAt(factor)) allowed = factor;
      else blocked = factor;
    }
    candidateAt(allowed);
    return [...pointIds].some((pointId) => {
      const point = this.getPoint(pointId);
      const start = origin.get(pointId);
      return point.xMm !== start.xMm || point.zMm !== start.zMm;
    });
  }

  setWallProperties(id, changes) {
    const wall = this.getWall(id);
    if (!wall) return false;
    const before = this.toJSON();
    if (Number.isFinite(changes.lengthMm) && changes.lengthMm > 0 && !this.setWallLength(id, changes.lengthMm)) return false;
    if (Number.isFinite(changes.visibleLengthMm) && changes.visibleLengthMm > 0
      && !this.setWallVisibleLength(id, changes.visibleLengthMm)) return false;
    if (Number.isFinite(changes.heightMm) && changes.heightMm > 0) wall.heightMm = Math.round(changes.heightMm);
    if (Number.isFinite(changes.thicknessMm) && changes.thicknessMm > 0) wall.thicknessMm = Math.round(changes.thicknessMm);
    if (wallOverlapsAny(this, wall)
      || (Number.isFinite(changes.angleDeg) && !this.setWallAngle(id, changes.angleDeg))) {
      this.restore(before);
      return false;
    }
    this.windows.filter((item) => item.wallId === id).forEach((item) => this.setWindowProperties(item.id, {}));
    return true;
  }

  deleteWall(id) {
    const index = this.walls.findIndex((wall) => wall.id === id);
    if (index < 0) return;
    this.walls.splice(index, 1);
    this.windows = this.windows.filter((item) => item.wallId !== id);
    this.isClosed = false;
    const usedPointIds = new Set(this.walls.flatMap((wall) => [wall.startPointId, wall.endPointId]));
    this.points = this.points.filter((point) => usedPointIds.has(point.id));
  }

  toJSON() {
    return JSON.parse(JSON.stringify({
      wallHeightMm: this.wallHeightMm,
      wallThicknessMm: this.wallThicknessMm,
      gridStepMm: this.gridStepMm,
      snapEnabled: this.snapEnabled,
      isClosed: this.isClosed,
      points: this.points,
      walls: this.walls,
      windows: this.windows,
      nextPointNumber: this.nextPointNumber,
      nextWallNumber: this.nextWallNumber,
      nextWindowNumber: this.nextWindowNumber,
      nextGroupNumber: this.nextGroupNumber,
    }));
  }

  restore(data) {
    const copy = JSON.parse(JSON.stringify(data));
    Object.assign(this, copy);
    this.windows ??= [];
    this.windows.forEach((item) => { item.kind ??= "window"; });
    this.nextGroupNumber ??= 1;
    this.syncCounters();
  }

  syncCounters() {
    const pointMax = Math.max(0, ...this.points.map((point) => Number(point.id.split("-").at(-1)) || 0));
    const wallMax = Math.max(0, ...this.walls.map((wall) => Number(wall.id.split("-").at(-1)) || 0));
    const windowMax = Math.max(0, ...this.windows.map((item) => Number(item.id.split("-").at(-1)) || 0));
    this.nextPointNumber = Math.max(this.nextPointNumber ?? 1, pointMax + 1);
    this.nextWallNumber = Math.max(this.nextWallNumber ?? 1, wallMax + 1);
    this.nextWindowNumber = Math.max(this.nextWindowNumber ?? 1, windowMax + 1);
  }
}
