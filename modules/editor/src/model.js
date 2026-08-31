const MIN_SIZE_MM = 1;
const ATTACH_DISTANCE_MM = 35;
const PART_SNAP_DISTANCE_MM = 20;
const CONFIRMAT_HEAD_RADIUS_MM = 5.5;
const PART_TYPES = new Set(["bottom", "side", "shelf", "top"]);

function normalizedAngle(value) {
  return ((value % 360) + 360) % 360;
}

function rotatedCorner(x, y, z, part) {
  const rx = (part.rotationX * Math.PI) / 180;
  const ry = (part.rotationY * Math.PI) / 180;
  const rz = (part.rotationZ * Math.PI) / 180;
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const yX = y * cosX - z * sinX;
  const zX = y * sinX + z * cosX;
  const xY = x * cosY + zX * sinY;
  const zY = -x * sinY + zX * cosY;
  return {
    x: xY * cosZ - yX * sinZ,
    y: xY * sinZ + yX * cosZ,
    z: zY,
  };
}

export function getPartAabb(part) {
  const halfX = part.sizeX / 2;
  const halfY = part.sizeY / 2;
  const halfZ = part.sizeZ / 2;
  const corners = [];
  for (const x of [-halfX, halfX]) {
    for (const y of [-halfY, halfY]) {
      for (const z of [-halfZ, halfZ]) corners.push(rotatedCorner(x, y, z, part));
    }
  }
  const localMinY = Math.min(...corners.map((corner) => corner.y));
  const centerY = part.yMm - localMinY;
  return {
    minX: part.xMm + Math.min(...corners.map((corner) => corner.x)),
    maxX: part.xMm + Math.max(...corners.map((corner) => corner.x)),
    minY: centerY + localMinY,
    maxY: centerY + Math.max(...corners.map((corner) => corner.y)),
    minZ: part.zMm + Math.min(...corners.map((corner) => corner.z)),
    maxZ: part.zMm + Math.max(...corners.map((corner) => corner.z)),
  };
}

function aabbsOverlap(first, second, epsilon = 0.01) {
  return Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX) > epsilon
    && Math.min(first.maxY, second.maxY) - Math.max(first.minY, second.minY) > epsilon
    && Math.min(first.maxZ, second.maxZ) - Math.max(first.minZ, second.minZ) > epsilon;
}

function footprintsOverlap(first, second, epsilon = 0.01) {
  return Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX) > epsilon
    && Math.min(first.maxZ, second.maxZ) - Math.max(first.minZ, second.minZ) > epsilon;
}

function rangeGap(firstMin, firstMax, secondMin, secondMax) {
  if (firstMax < secondMin) return secondMin - firstMax;
  if (secondMax < firstMin) return firstMin - secondMax;
  return 0;
}

function overlapVolume(first, second) {
  const x = Math.max(0, Math.min(first.maxX, second.maxX) - Math.max(first.minX, second.minX));
  const y = Math.max(0, Math.min(first.maxY, second.maxY) - Math.max(first.minY, second.minY));
  const z = Math.max(0, Math.min(first.maxZ, second.maxZ) - Math.max(first.minZ, second.minZ));
  return x * y * z;
}

export function getConfirmatPlacement(model, connectionOrIds, insetOverride) {
  const partIds = Array.isArray(connectionOrIds) ? connectionOrIds : connectionOrIds.partIds;
  const insetMm = Math.max(0, Math.round(
    insetOverride ?? connectionOrIds.insetMm ?? 60,
  ));
  const [first, second] = partIds.map((id) => model.getPart(id));
  if (!first || !second) return null;
  const firstBounds = getPartAabb(first);
  const secondBounds = getPartAabb(second);
  const definitions = {
    x: { min: "minX", max: "maxX", tangents: ["y", "z"] },
    y: { min: "minY", max: "maxY", tangents: ["x", "z"] },
    z: { min: "minZ", max: "maxZ", tangents: ["x", "y"] },
  };
  let joint = null;
  Object.entries(definitions).some(([axis, definition]) => {
    const tangentsOverlap = definition.tangents.every((tangent) => {
      const min = `min${tangent.toUpperCase()}`;
      const max = `max${tangent.toUpperCase()}`;
      return Math.min(firstBounds[max], secondBounds[max])
        - Math.max(firstBounds[min], secondBounds[min]) > 0.01;
    });
    if (!tangentsOverlap) return false;
    if (Math.abs(firstBounds[definition.max] - secondBounds[definition.min]) <= 1.01) {
      joint = { axis, firstSide: 1, definition };
      return true;
    }
    if (Math.abs(firstBounds[definition.min] - secondBounds[definition.max]) <= 1.01) {
      joint = { axis, firstSide: -1, definition };
      return true;
    }
    return false;
  });
  if (!joint) return null;
  const axisMin = `min${joint.axis.toUpperCase()}`;
  const axisMax = `max${joint.axis.toUpperCase()}`;
  const firstExtent = firstBounds[axisMax] - firstBounds[axisMin];
  const secondExtent = secondBounds[axisMax] - secondBounds[axisMin];
  const headPart = first.partType === "bottom"
    ? first
    : second.partType === "bottom"
      ? second
      : firstExtent <= secondExtent ? first : second;
  const headBounds = headPart.id === first.id ? firstBounds : secondBounds;
  const headJointSide = headPart.id === first.id ? joint.firstSide : -joint.firstSide;
  const outerSide = -headJointSide;
  const tangentData = joint.definition.tangents.map((axis) => {
    const min = `min${axis.toUpperCase()}`;
    const max = `max${axis.toUpperCase()}`;
    return {
      axis,
      min: Math.max(firstBounds[min], secondBounds[min]),
      max: Math.min(firstBounds[max], secondBounds[max]),
    };
  });
  tangentData.sort((a, b) => (b.max - b.min) - (a.max - a.min));
  const span = tangentData[0];
  const fixed = tangentData[1];
  const spanLength = span.max - span.min;
  const effectiveInset = Math.min(insetMm, spanLength / 3);
  const defaultValues = [span.min + effectiveInset, span.max - effectiveInset];
  const centerClearance = Math.min(CONFIRMAT_HEAD_RADIUS_MM, spanLength / 2);
  const roundedMinimum = Math.ceil(span.min + centerClearance);
  const roundedMaximum = Math.floor(span.max - centerClearance);
  const minimumValue = roundedMinimum <= roundedMaximum
    ? roundedMinimum
    : Math.round((span.min + span.max) / 2);
  const maximumValue = roundedMinimum <= roundedMaximum ? roundedMaximum : minimumValue;
  const savedValues = !Array.isArray(connectionOrIds) && Array.isArray(connectionOrIds.positionsMm)
    ? connectionOrIds.positionsMm
    : defaultValues;
  const values = defaultValues.map((fallback, index) => {
    const requested = Number.isFinite(savedValues[index]) ? Math.round(savedValues[index]) : fallback;
    return Math.max(minimumValue, Math.min(maximumValue, requested));
  });
  const surface = outerSide < 0 ? headBounds[axisMin] : headBounds[axisMax];
  const points = values.map((value) => {
    const point = { xMm: 0, yMm: 0, zMm: 0 };
    point[`${joint.axis}Mm`] = surface;
    point[`${span.axis}Mm`] = value;
    point[`${fixed.axis}Mm`] = (fixed.min + fixed.max) / 2;
    return point;
  });
  return {
    headPartId: headPart.id,
    axis: joint.axis,
    outerSide,
    spanAxis: span.axis,
    spanMin: span.min,
    spanMax: span.max,
    fixedAxis: fixed.axis,
    fixedValue: (fixed.min + fixed.max) / 2,
    surface,
    values,
    points,
  };
}

export const PART_TEMPLATES = {
  shelf: { name: "Панель", sizeX: 600, sizeY: 16, sizeZ: 400 },
  side: { name: "Боковина", sizeX: 16, sizeY: 720, sizeZ: 400 },
  facade: { name: "Фасад", sizeX: 600, sizeY: 720, sizeZ: 16 },
};

export class FurnitureModel {
  constructor() {
    this.parts = [];
    this.connections = [];
    this.nextPartNumber = 1;
    this.nextConnectionNumber = 1;
    this.gridStepMm = 1;
  }

  addPart(templateName = "shelf") {
    const template = PART_TEMPLATES[templateName] ?? PART_TEMPLATES.shelf;
    const index = this.parts.length;
    const part = {
      id: `part-${this.nextPartNumber++}`,
      name: `${template.name} ${this.nextPartNumber - 1}`,
      partType: templateName === "side" ? "side" : "shelf",
      sizeX: template.sizeX,
      sizeY: template.sizeY,
      sizeZ: template.sizeZ,
      xMm: index * 30,
      yMm: 0,
      zMm: index * 30,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
    };
    this.placeInFreeArea(part);
    this.parts.push(part);
    return part;
  }

  addCustomPart({
    material = "ldsp-16",
    lengthMm = 600,
    widthMm = 400,
    partType = "shelf",
  } = {}) {
    const thicknessMm = material === "ldsp-16" ? 16 : 16;
    const resolvedPartType = PART_TYPES.has(partType) ? partType : "shelf";
    const typeNames = {
      bottom: "Дно",
      side: "Боковина",
      shelf: "Полка",
      top: "Крыша",
    };
    const partNumber = this.nextPartNumber++;
    const index = this.parts.length;
    const part = {
      id: `part-${partNumber}`,
      kind: "part",
      name: `${typeNames[resolvedPartType]} ${partNumber}`,
      partType: resolvedPartType,
      material,
      materialName: "ЛДСП 16 мм",
      sizeX: Math.max(MIN_SIZE_MM, Math.round(lengthMm)),
      sizeY: thicknessMm,
      sizeZ: Math.max(MIN_SIZE_MM, Math.round(widthMm)),
      xMm: index * 30,
      yMm: 0,
      zMm: index * 30,
      rotationX: 0,
      rotationY: 0,
      rotationZ: resolvedPartType === "side" ? 90 : 0,
    };
    this.placeInFreeArea(part);
    this.parts.push(part);
    return part;
  }

  addLeg() {
    const partNumber = this.nextPartNumber++;
    const index = this.parts.length;
    const leg = {
      id: `part-${partNumber}`,
      kind: "hardware",
      hardwareType: "leg",
      name: `Ножка ${partNumber}`,
      material: "hardware-leg",
      materialName: "Фурнитура",
      sizeX: 57,
      sizeY: 100,
      sizeZ: 57,
      xMm: index * 30,
      yMm: 0,
      zMm: index * 30,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
    };
    this.placeInFreeArea(leg);
    this.parts.push(leg);
    return leg;
  }

  placeInFreeArea(part, marginMm = 80) {
    if (!this.parts.length) return part;
    let candidateBounds = getPartAabb(part);
    const occupied = this.parts.some((other) => (
      footprintsOverlap(candidateBounds, getPartAabb(other))
    ));
    if (!occupied) return part;
    const existingBounds = this.parts.map((item) => getPartAabb(item));
    const maxX = Math.max(...existingBounds.map((bounds) => bounds.maxX));
    const minZ = Math.min(...existingBounds.map((bounds) => bounds.minZ));
    const maxZ = Math.max(...existingBounds.map((bounds) => bounds.maxZ));
    const halfWidth = (candidateBounds.maxX - candidateBounds.minX) / 2;
    part.xMm = Math.ceil(maxX + marginMm + halfWidth);
    part.zMm = Math.round((minZ + maxZ) / 2);
    candidateBounds = getPartAabb(part);
    return part;
  }

  getPart(id) {
    return this.parts.find((part) => part.id === id) ?? null;
  }

  getConnection(id) {
    return this.connections.find((connection) => connection.id === id) ?? null;
  }

  getConnectionBetween(ids) {
    const partIds = [...new Set(ids)];
    if (partIds.length !== 2) return null;
    return this.connections.find((connection) => (
      connection.partIds.length === 2
      && connection.partIds.every((id) => partIds.includes(id))
    )) ?? null;
  }

  getConnectedPartIds(id) {
    if (!this.getPart(id)) return [];
    const connected = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      this.connections.forEach((connection) => {
        if (!connection.partIds.some((partId) => connected.has(partId))) return;
        connection.partIds.forEach((partId) => {
          if (connected.has(partId)) return;
          connected.add(partId);
          changed = true;
        });
      });
    }
    return [...connected];
  }

  isSideStandingOnBottom(bottom, side) {
    if (bottom?.partType !== "bottom" || side?.partType !== "side") return false;
    const bottomBounds = getPartAabb(bottom);
    const sideBounds = getPartAabb(side);
    const restsOnTop = Math.abs(sideBounds.minY - bottomBounds.maxY) <= 1.01;
    const overlapsBottom = Math.min(sideBounds.maxX, bottomBounds.maxX)
        - Math.max(sideBounds.minX, bottomBounds.minX) > 0.01
      && Math.min(sideBounds.maxZ, bottomBounds.maxZ)
        - Math.max(sideBounds.minZ, bottomBounds.minZ) > 0.01;
    return restsOnTop && overlapsBottom;
  }

  syncConnectedSideFronts(partId = null) {
    this.connections.forEach((connection) => {
      if (partId && !connection.partIds.includes(partId)) return;
      const connectedParts = connection.partIds.map((id) => this.getPart(id));
      const bottom = connectedParts.find((part) => part?.partType === "bottom");
      const side = connectedParts.find((part) => part?.partType === "side");
      if (!this.isSideStandingOnBottom(bottom, side)) return;
      side.frontDirection = bottom.frontDirection ?? null;
    });
  }

  updatePart(id, changes) {
    const part = this.getPart(id);
    if (!part) return false;
    const previousPosition = { xMm: part.xMm, yMm: part.yMm, zMm: part.zMm };
    const previousRotationY = part.rotationY;
    const numeric = (key, fallback) => Number.isFinite(changes[key]) ? Math.round(changes[key]) : fallback;
    const attachedParts = this.parts.filter((item) => item.attachedTo === part.id);
    const hasLockedSupports = attachedParts.some((item) => item.lockedTo === part.id);
    part.name = typeof changes.name === "string" && changes.name.trim() ? changes.name.trim() : part.name;
    part.partType = PART_TYPES.has(changes.partType) ? changes.partType : (part.partType ?? "shelf");
    if (Object.hasOwn(changes, "faceSide")) {
      part.faceSide = changes.faceSide === 1 || changes.faceSide === -1 ? changes.faceSide : null;
    } else {
      part.faceSide ??= null;
    }
    part.frontDirection = ["x+", "x-", "z+", "z-"].includes(changes.frontDirection)
      ? changes.frontDirection
      : (part.frontDirection ?? null);
    const isLeg = part.hardwareType === "leg";
    part.sizeX = isLeg ? 57 : Math.max(MIN_SIZE_MM, numeric("sizeX", part.sizeX));
    part.sizeY = isLeg
      ? 100
      : part.material === "ldsp-16"
        ? 16
        : Math.max(MIN_SIZE_MM, numeric("sizeY", part.sizeY));
    part.sizeZ = isLeg ? 57 : Math.max(MIN_SIZE_MM, numeric("sizeZ", part.sizeZ));
    part.xMm = numeric("xMm", part.xMm);
    const requestedY = Math.max(0, numeric("yMm", part.yMm));
    const lowestAttachedY = attachedParts.length
      ? Math.min(...attachedParts.map((item) => item.yMm))
      : Infinity;
    part.yMm = requestedY < previousPosition.yMm - lowestAttachedY
      ? previousPosition.yMm - lowestAttachedY
      : requestedY;
    part.zMm = numeric("zMm", part.zMm);
    part.rotationX = hasLockedSupports ? part.rotationX : numeric("rotationX", part.rotationX);
    part.rotationY = numeric("rotationY", part.rotationY);
    part.rotationZ = hasLockedSupports ? part.rotationZ : numeric("rotationZ", part.rotationZ);
    const dxMm = part.xMm - previousPosition.xMm;
    const dyMm = part.yMm - previousPosition.yMm;
    const dzMm = part.zMm - previousPosition.zMm;
    const rotationDeltaY = part.rotationY - previousRotationY;
    if (dxMm || dyMm || dzMm || rotationDeltaY) {
      const angle = (rotationDeltaY * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      attachedParts.forEach((item) => {
        const relativeX = item.xMm - previousPosition.xMm;
        const relativeZ = item.zMm - previousPosition.zMm;
        item.xMm = Math.round((part.xMm + relativeX * cos + relativeZ * sin) * 2) / 2;
        item.yMm += dyMm;
        item.zMm = Math.round((part.zMm - relativeX * sin + relativeZ * cos) * 2) / 2;
        item.rotationY += rotationDeltaY;
      });
    }
    this.syncConnectedSideFronts(part.id);
    return true;
  }

  movePartConstrained(id, changes) {
    const part = this.getPart(id);
    if (!part) return false;
    if (part.hardwareType !== "leg") {
      const connectedPartIds = this.getConnectedPartIds(id);
      if (connectedPartIds.length > 1) {
        return this.moveConnectedPartsConstrained(id, changes, connectedPartIds);
      }
      const number = (key, fallback) => Number.isFinite(changes[key]) ? Math.round(changes[key]) : fallback;
      const candidate = {
        ...part,
        sizeX: Math.max(MIN_SIZE_MM, number("sizeX", part.sizeX)),
        sizeY: part.material === "ldsp-16"
          ? 16
          : Math.max(MIN_SIZE_MM, number("sizeY", part.sizeY)),
        sizeZ: Math.max(MIN_SIZE_MM, number("sizeZ", part.sizeZ)),
        xMm: number("xMm", part.xMm),
        yMm: Math.max(0, number("yMm", part.yMm)),
        zMm: number("zMm", part.zMm),
        rotationX: number("rotationX", part.rotationX),
        rotationY: number("rotationY", part.rotationY),
        rotationZ: number("rotationZ", part.rotationZ),
      };
      const positionChanged = Number.isFinite(changes.xMm)
        || Number.isFinite(changes.yMm)
        || Number.isFinite(changes.zMm);
      const snappedTo = new Set();
      const axisDefinitions = {
        x: { position: "xMm", min: "minX", max: "maxX", others: [["minY", "maxY"], ["minZ", "maxZ"]] },
        y: { position: "yMm", min: "minY", max: "maxY", others: [["minX", "maxX"], ["minZ", "maxZ"]] },
        z: { position: "zMm", min: "minZ", max: "maxZ", others: [["minX", "maxX"], ["minY", "maxY"]] },
      };
      if (positionChanged) {
        const movingAxes = [];
        if (Number.isFinite(changes.yMm)) movingAxes.push("y");
        if (Number.isFinite(changes.xMm)) movingAxes.push("x");
        if (Number.isFinite(changes.zMm)) movingAxes.push("z");
        movingAxes.forEach((axis) => {
          const definition = axisDefinitions[axis];
          const candidateBounds = getPartAabb(candidate);
          let best = null;
          this.parts.filter((other) => other.id !== id && other.kind !== "hardware").forEach((other) => {
            const otherBounds = getPartAabb(other);
            const nearOnOtherAxes = definition.others.every(([min, max]) => (
              rangeGap(candidateBounds[min], candidateBounds[max], otherBounds[min], otherBounds[max])
                <= PART_SNAP_DISTANCE_MM
            ));
            if (!nearOnOtherAxes) return;
            const external = [
              otherBounds[definition.min] - candidateBounds[definition.max],
              otherBounds[definition.max] - candidateBounds[definition.min],
            ].filter((delta) => Math.abs(delta) <= PART_SNAP_DISTANCE_MM);
            const aligned = [
              otherBounds[definition.min] - candidateBounds[definition.min],
              otherBounds[definition.max] - candidateBounds[definition.max],
            ].filter((delta) => Math.abs(delta) <= PART_SNAP_DISTANCE_MM);
            const options = external.length ? external : aligned;
            options.forEach((delta) => {
              if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, other };
            });
          });
          if (best && Math.abs(best.delta) > 0.01) {
            candidate[definition.position] += best.delta;
            if (axis === "y") candidate.yMm = Math.max(0, candidate.yMm);
            snappedTo.add(best.other.id);
          }
        });
      }
      const candidateBounds = getPartAabb(candidate);
      const currentBounds = getPartAabb(part);
      const candidateOverlap = this.parts.reduce((sum, other) => (
        other.id === id || other.attachedTo === id
          ? sum
          : sum + overlapVolume(candidateBounds, getPartAabb(other))
      ), 0);
      const currentOverlap = this.parts.reduce((sum, other) => (
        other.id === id || other.attachedTo === id
          ? sum
          : sum + overlapVolume(currentBounds, getPartAabb(other))
      ), 0);
      if (candidateOverlap > 0.01 && candidateOverlap >= currentOverlap - 0.01) return false;
      return this.updatePart(id, {
        ...changes,
        xMm: candidate.xMm,
        yMm: candidate.yMm,
        zMm: candidate.zMm,
      }) ? { moved: true, snappedTo: snappedTo.size ? [...snappedTo] : null } : false;
    }

    const candidate = {
      ...part,
      xMm: Number.isFinite(changes.xMm) ? Math.round(changes.xMm) : part.xMm,
      yMm: Number.isFinite(changes.yMm) ? Math.max(0, Math.round(changes.yMm)) : part.yMm,
      zMm: Number.isFinite(changes.zMm) ? Math.round(changes.zMm) : part.zMm,
    };
    let candidateBounds = getPartAabb(candidate);
    let attachedTo = null;
    const vertical = normalizedAngle(candidate.rotationX) % 180 === 0
      && normalizedAngle(candidate.rotationZ) % 180 === 0;

    if (vertical) {
      let nearest = null;
      this.parts.filter((item) => item.id !== id && item.kind !== "hardware").forEach((panel) => {
        const panelBounds = getPartAabb(panel);
        const fitsUnderPanel = candidateBounds.minX >= panelBounds.minX - 0.01
          && candidateBounds.maxX <= panelBounds.maxX + 0.01
          && candidateBounds.minZ >= panelBounds.minZ - 0.01
          && candidateBounds.maxZ <= panelBounds.maxZ + 0.01;
        const gap = panelBounds.minY - candidateBounds.maxY;
        if (!fitsUnderPanel || Math.abs(gap) > ATTACH_DISTANCE_MM) return;
        if (!nearest || Math.abs(gap) < Math.abs(nearest.gap)) nearest = { panel, gap };
      });
      if (nearest) {
        candidate.yMm = Math.max(0, Math.round(candidate.yMm + nearest.gap));
        candidateBounds = getPartAabb(candidate);
        attachedTo = nearest.panel.id;
      }
    }

    const blocked = this.parts.some((other) => (
      other.id !== id && aabbsOverlap(candidateBounds, getPartAabb(other))
    ));
    if (blocked) return false;
    part.attachedTo = attachedTo;
    this.updatePart(id, candidate);
    return { moved: true, snappedTo: attachedTo };
  }

  moveConnectedPartsConstrained(id, changes, connectedPartIds = this.getConnectedPartIds(id)) {
    const anchor = this.getPart(id);
    if (!anchor || connectedPartIds.length < 2) return false;
    const geometryKeys = ["sizeX", "sizeY", "sizeZ", "rotationX", "rotationY", "rotationZ"];
    if (geometryKeys.some((key) => (
      Number.isFinite(changes[key]) && Math.round(changes[key]) !== anchor[key]
    ))) return false;

    const requestedX = Number.isFinite(changes.xMm) ? Math.round(changes.xMm) : anchor.xMm;
    const requestedY = Number.isFinite(changes.yMm) ? Math.max(0, Math.round(changes.yMm)) : anchor.yMm;
    const requestedZ = Number.isFinite(changes.zMm) ? Math.round(changes.zMm) : anchor.zMm;
    const dxMm = requestedX - anchor.xMm;
    let dyMm = requestedY - anchor.yMm;
    const dzMm = requestedZ - anchor.zMm;
    if (!dxMm && !dyMm && !dzMm) return { moved: true, snappedTo: null };

    const rigidIds = new Set(connectedPartIds);
    this.parts.forEach((part) => {
      if (rigidIds.has(part.attachedTo) || rigidIds.has(part.lockedTo)) rigidIds.add(part.id);
    });
    const rigidParts = this.parts.filter((part) => rigidIds.has(part.id));
    const lowestY = Math.min(...rigidParts.map((part) => getPartAabb(part).minY));
    if (lowestY + dyMm < 0) dyMm = -lowestY;

    const shifted = new Map(rigidParts.map((part) => [part.id, {
      ...part,
      xMm: part.xMm + dxMm,
      yMm: part.yMm + dyMm,
      zMm: part.zMm + dzMm,
    }]));
    const outsiders = this.parts.filter((part) => !rigidIds.has(part.id));
    const blocked = rigidParts.some((part) => outsiders.some((other) => {
      const candidateOverlap = overlapVolume(getPartAabb(shifted.get(part.id)), getPartAabb(other));
      const currentOverlap = overlapVolume(getPartAabb(part), getPartAabb(other));
      return candidateOverlap > 0.01 && candidateOverlap >= currentOverlap - 0.01;
    }));
    if (blocked) return false;

    rigidParts.forEach((part) => {
      const candidate = shifted.get(part.id);
      part.xMm = candidate.xMm;
      part.yMm = candidate.yMm;
      part.zMm = candidate.zMm;
    });
    return { moved: true, snappedTo: null, connected: connectedPartIds };
  }

  placeBottomLegs(bottomId, insetMm = 40) {
    const bottom = this.getPart(bottomId);
    const inset = Math.max(0, Math.round(insetMm));
    const legRadius = 57 / 2;
    if (!bottom || bottom.kind === "hardware" || bottom.partType !== "bottom") return false;
    const horizontal = normalizedAngle(bottom.rotationX) % 180 === 0
      && normalizedAngle(bottom.rotationZ) % 180 === 0;
    const offsetX = bottom.sizeX / 2 - inset - legRadius;
    const offsetZ = bottom.sizeZ / 2 - inset - legRadius;
    if (!horizontal || offsetX <= 0 || offsetZ <= 0) return false;

    this.parts = this.parts.filter((part) => !(
      part.hardwareType === "leg" && part.autoPlaced && part.attachedTo === bottom.id
    ));
    if (bottom.yMm < 100) this.updatePart(bottom.id, { yMm: 100 });

    const angle = (bottom.rotationY * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const groupId = `leg-group-${bottom.id}`;
    const legs = [];
    for (const localX of [-offsetX, offsetX]) {
      for (const localZ of [-offsetZ, offsetZ]) {
        const leg = this.addLeg();
        leg.xMm = Math.round((bottom.xMm + localX * cos + localZ * sin) * 2) / 2;
        leg.yMm = Math.max(0, Math.round(bottom.yMm - leg.sizeY));
        leg.zMm = Math.round((bottom.zMm - localX * sin + localZ * cos) * 2) / 2;
        leg.rotationY = bottom.rotationY;
        leg.attachedTo = bottom.id;
        leg.lockedTo = bottom.id;
        leg.groupId = groupId;
        leg.autoPlaced = true;
        legs.push(leg);
      }
    }
    return legs;
  }

  connectParts(ids, type = "confirmat", insetMm = 60) {
    const partIds = [...new Set(ids)].filter((id) => this.getPart(id));
    if (partIds.length !== 2 || type !== "confirmat") return false;
    if (partIds.some((id) => this.getPart(id).kind === "hardware")) return false;
    const placement = getConfirmatPlacement(this, partIds, insetMm);
    if (!placement) return false;
    const duplicate = this.connections.some((connection) => (
      connection.type === type
      && connection.partIds.every((id) => partIds.includes(id))
    ));
    if (duplicate) return false;
    const connection = {
      id: `connection-${this.nextConnectionNumber++}`,
      type,
      partIds,
      insetMm: Math.max(0, Math.round(insetMm)),
      positionsMm: [...placement.values],
    };
    this.connections.push(connection);
    this.syncConnectedSideFronts();
    return connection;
  }

  moveConfirmat(connectionId, pointIndex, positionMm) {
    const connection = this.getConnection(connectionId);
    const index = Number(pointIndex);
    if (!connection || !Number.isInteger(index) || index < 0 || index > 1) return false;
    if (!Number.isFinite(positionMm)) return false;
    const placement = getConfirmatPlacement(this, connection);
    if (!placement) return false;
    const clearance = Math.min(
      CONFIRMAT_HEAD_RADIUS_MM,
      (placement.spanMax - placement.spanMin) / 2,
    );
    const roundedMinimum = Math.ceil(placement.spanMin + clearance);
    const roundedMaximum = Math.floor(placement.spanMax - clearance);
    const minimum = roundedMinimum <= roundedMaximum
      ? roundedMinimum
      : Math.round((placement.spanMin + placement.spanMax) / 2);
    const maximum = roundedMinimum <= roundedMaximum ? roundedMaximum : minimum;
    connection.positionsMm = [...placement.values];
    connection.positionsMm[index] = Math.round(Math.max(minimum, Math.min(maximum, positionMm)));
    return connection.positionsMm[index];
  }

  disconnectParts(ids) {
    const connection = this.getConnectionBetween(ids);
    if (!connection) return false;
    this.connections = this.connections.filter((item) => item.id !== connection.id);
    return connection;
  }

  deleteConnection(id) {
    const connection = this.getConnection(id);
    if (!connection) return false;
    this.connections = this.connections.filter((item) => item.id !== id);
    return connection;
  }

  duplicateParts(ids) {
    const copies = ids.map((id) => this.getPart(id)).filter(Boolean).map((source) => {
      const copy = {
        ...source,
        id: `part-${this.nextPartNumber++}`,
        name: `${source.name} копия`,
        xMm: source.xMm + 20,
        zMm: source.zMm + 20,
        attachedTo: null,
      };
      this.parts.push(copy);
      return copy;
    });
    return copies;
  }

  deleteParts(ids) {
    const targets = new Set(ids);
    this.parts.forEach((part) => {
      if (targets.has(part.lockedTo)) targets.add(part.id);
    });
    this.parts = this.parts.filter((part) => !targets.has(part.id));
    this.connections = this.connections.filter((connection) => (
      !connection.partIds.some((id) => targets.has(id))
    ));
    this.parts.forEach((part) => {
      if (targets.has(part.attachedTo)) part.attachedTo = null;
    });
  }

  toJSON() {
    return JSON.parse(JSON.stringify({
      parts: this.parts,
      connections: this.connections,
      nextPartNumber: this.nextPartNumber,
      nextConnectionNumber: this.nextConnectionNumber,
      gridStepMm: this.gridStepMm,
    }));
  }

  restore(state) {
    Object.assign(this, JSON.parse(JSON.stringify(state)));
    this.connections ??= [];
    this.nextConnectionNumber ??= this.connections.length + 1;
    this.parts.forEach((part) => {
      if (part.kind !== "hardware" && !PART_TYPES.has(part.partType)) part.partType = "shelf";
      if (part.hardwareType === "leg") {
        part.sizeX = 57;
        part.sizeY = 100;
        part.sizeZ = 57;
      }
    });
    this.parts.filter((part) => part.hardwareType !== "leg").forEach((panel) => {
      const attachedLegs = this.parts.filter((part) => (
        part.hardwareType === "leg" && part.attachedTo === panel.id
      ));
      if (!attachedLegs.length) return;
      let panelBounds = getPartAabb(panel);
      const requiredBottomY = Math.max(...attachedLegs.map((leg) => {
        const bounds = getPartAabb(leg);
        return bounds.maxY - bounds.minY;
      }));
      if (panelBounds.minY < requiredBottomY) {
        panel.yMm += Math.ceil(requiredBottomY - panelBounds.minY);
        panelBounds = getPartAabb(panel);
      }
      attachedLegs.forEach((leg) => {
        const bounds = getPartAabb(leg);
        leg.yMm = Math.max(0, Math.round(panelBounds.minY - (bounds.maxY - bounds.minY)));
      });
    });
    this.syncConnectedSideFronts();
  }
}

export class History {
  constructor(model, onChange) {
    this.model = model;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
  }

  commit(label, mutation) {
    const before = this.model.toJSON();
    const result = mutation();
    if (result === false) return false;
    const after = this.model.toJSON();
    this.undoStack.push({ label, before, after });
    this.redoStack.length = 0;
    this.onChange?.();
    return result ?? true;
  }

  push(label, before, after) {
    this.undoStack.push({ label, before, after });
    this.redoStack.length = 0;
    this.onChange?.();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.model.restore(entry.before);
    this.redoStack.push(entry);
    this.onChange?.();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.model.restore(entry.after);
    this.undoStack.push(entry);
    this.onChange?.();
  }
}
