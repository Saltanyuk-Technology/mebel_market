export class FurnitureInstanceModel {
  constructor(data) {
    this.id = data.id;
    this.definitionId = data.definitionId;
    this.revisionId = data.revisionId;
    this.transform = structuredClone(data.transform ?? { positionMm: [0, 0, 0], rotationDeg: [0, 0, 0] });
    this.placement = structuredClone(data.placement ?? { anchor: "back-left-bottom" });
  }

  moveTo({ xMm, zMm, rotationY }) {
    const position = [...(this.transform.positionMm ?? [0, 0, 0])];
    const rotation = [...(this.transform.rotationDeg ?? [0, 0, 0])];
    if (Number.isFinite(xMm)) position[0] = xMm;
    if (Number.isFinite(zMm)) position[2] = zMm;
    if (Number.isFinite(rotationY)) rotation[1] = rotationY;
    this.transform.positionMm = position;
    this.transform.rotationDeg = rotation;
  }

  get xMm() { return this.transform.positionMm?.[0] ?? 0; }
  get zMm() { return this.transform.positionMm?.[2] ?? 0; }
  get rotationY() { return this.transform.rotationDeg?.[1] ?? 0; }

  toJSON() {
    return {
      id: this.id, definitionId: this.definitionId, revisionId: this.revisionId,
      transform: structuredClone(this.transform), placement: structuredClone(this.placement),
    };
  }
}

export function renderableParts(document) {
  const entities = [
    ...(document?.entities?.panels ?? []),
    ...(document?.entities?.hardwareInstances ?? []),
  ];
  return entities.map((entity) => entity.legacyData ?? {
    id: entity.id,
    kind: entity.entityType === "hardware-instance" ? "hardware" : "part",
    hardwareType: entity.hardwareType,
    material: entity.materialRef?.legacyCode,
    sizeX: entity.dimensionsMm?.x ?? 0,
    sizeY: entity.dimensionsMm?.y ?? 0,
    sizeZ: entity.dimensionsMm?.z ?? 0,
    xMm: entity.transform?.positionMm?.[0] ?? 0,
    yMm: entity.transform?.positionMm?.[1] ?? 0,
    zMm: entity.transform?.positionMm?.[2] ?? 0,
    rotationX: entity.transform?.rotationDeg?.[0] ?? 0,
    rotationY: entity.transform?.rotationDeg?.[1] ?? 0,
    rotationZ: entity.transform?.rotationDeg?.[2] ?? 0,
  });
}
