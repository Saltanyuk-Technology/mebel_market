import { createEntityId } from "./identifiers.js";

export const DOCUMENT_SCHEMA_VERSION = 2;
export const ENTITY_COLLECTIONS = [
  "assemblies",
  "panels",
  "facades",
  "hardwareInstances",
  "connections",
  "machiningOperations",
];

export function createFurnitureDocument({
  name = "Новый элемент",
  componentType = "cabinet",
} = {}) {
  const rootAssemblyId = createEntityId();
  return {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    documentType: "furniture-definition",
    rootAssemblyId,
    metadata: {
      name: String(name).trim() || "Новый элемент",
      componentType: String(componentType).trim() || "cabinet",
      units: "mm",
    },
    entities: {
      assemblies: [{
        id: rootAssemblyId,
        entityType: "assembly",
        assemblyType: componentType || "cabinet",
        parentAssemblyId: null,
      }],
      panels: [],
      facades: [],
      hardwareInstances: [],
      connections: [],
      machiningOperations: [],
    },
    placement: {
      boundsMm: null,
      origin: { type: "back-left-bottom", positionMm: [0, 0, 0] },
      anchors: [],
      collisionVolumes: [],
    },
  };
}
