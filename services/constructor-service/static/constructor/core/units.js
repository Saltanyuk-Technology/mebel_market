export const MM_PER_SCENE_UNIT = 1000;

export function mmToWorld(valueMm) {
  return valueMm / MM_PER_SCENE_UNIT;
}

export function worldToMm(value) {
  return value * MM_PER_SCENE_UNIT;
}

export function distanceMm(a, b) {
  return Math.hypot(b.xMm - a.xMm, b.zMm - a.zMm);
}

export function roundMm(value) {
  return Math.round(value);
}

export function formatMm(value) {
  return `${Math.round(value).toLocaleString("ru-RU")} мм`;
}
