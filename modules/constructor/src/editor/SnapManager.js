import { distanceMm } from "../core/units.js";

function angularDistance(a, b) {
  let difference = Math.abs(a - b) % (Math.PI * 2);
  if (difference > Math.PI) difference = Math.PI * 2 - difference;
  return difference;
}

export class SnapManager {
  snap(rawPoint, room, anchor = null, thresholdMm = 140, ignoredPointId = null) {
    const point = { xMm: rawPoint.xMm, zMm: rawPoint.zMm };
    if (!room.snapEnabled) return { point, kind: null, targetPointId: null };

    const pointCandidate = this.findPointCandidate(point, room, thresholdMm, ignoredPointId);
    if (pointCandidate) {
      const canClose = room.walls.length >= 2 && pointCandidate.id === room.getOrderedContourPoints()[0]?.id;
      return {
        point: { xMm: pointCandidate.xMm, zMm: pointCandidate.zMm },
        kind: canClose ? "Замкнуть контур" : "Точка",
        targetPointId: pointCandidate.id,
      };
    }

    if (anchor) {
      const dx = point.xMm - anchor.xMm;
      const dz = point.zMm - anchor.zMm;
      const length = Math.hypot(dx, dz);
      if (length > 0) {
        const angle = Math.atan2(dz, dx);
        const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        if (angularDistance(angle, snappedAngle) < Math.PI / 24) {
          point.xMm = anchor.xMm + Math.cos(snappedAngle) * length;
          point.zMm = anchor.zMm + Math.sin(snappedAngle) * length;
          const degrees = ((snappedAngle * 180) / Math.PI + 360) % 360;
          const kind = degrees % 180 === 0 ? "Горизонталь" : degrees % 90 === 0 ? "Вертикаль" : "45°";
          return { point: this.round(point), kind, targetPointId: null };
        }
      }
    }

    const step = room.gridStepMm;
    point.xMm = Math.round(point.xMm / step) * step;
    point.zMm = Math.round(point.zMm / step) * step;
    return { point: this.round(point), kind: "Сетка", targetPointId: null };
  }

  findPointCandidate(point, room, thresholdMm, ignoredPointId) {
    let closest = null;
    let closestDistance = thresholdMm;
    room.points.forEach((candidate) => {
      if (candidate.id === ignoredPointId) return;
      const distance = distanceMm(point, candidate);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    });
    return closest;
  }

  round(point) {
    return { xMm: Math.round(point.xMm), zMm: Math.round(point.zMm) };
  }
}
