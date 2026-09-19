function baseOperation(type, panelId, source) {
  if (!panelId || !source?.type || !source?.id) throw new Error(`invalid_${type}_operation`);
  return { id: crypto.randomUUID(), entityType: "machining-operation", operationType: type, panelId, coordinateSystem: "panel-local", source: structuredClone(source) };
}

export function createDrillingOperation({ panelId, face, positionMm, diameterMm, depthMm, source } = {}) {
  if (!face || !Array.isArray(positionMm) || positionMm.length !== 2
    || !Number.isFinite(diameterMm) || diameterMm <= 0 || !Number.isFinite(depthMm) || depthMm <= 0) {
    throw new Error("invalid_drilling_operation");
  }
  return { ...baseOperation("drilling", panelId, source), face, positionMm: [...positionMm], diameterMm, depthMm };
}

export function createCutOperation({ panelId, pointsMm, depthMm, source } = {}) {
  if (!Array.isArray(pointsMm) || pointsMm.length < 2 || !Number.isFinite(depthMm) || depthMm <= 0) {
    throw new Error("invalid_cut_operation");
  }
  return { ...baseOperation("cut", panelId, source), pointsMm: structuredClone(pointsMm), depthMm };
}
