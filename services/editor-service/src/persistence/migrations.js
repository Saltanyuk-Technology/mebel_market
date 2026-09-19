import { createFurnitureDocument, DOCUMENT_SCHEMA_VERSION } from "../domain/document.js";
import { createEntityId } from "../domain/identifiers.js";
import { validateFurnitureDocument } from "../domain/validation.js";
import { getPartAabb } from "../model.js";
import { serializeFurnitureDocument } from "./serialize.js";

function boundsFor(parts) {
  if (!parts.length) return { width: 0, height: 0, depth: 0 };
  const bounds = parts.map((part) => getPartAabb(part));
  const minX = Math.min(...bounds.map((item) => item.minX));
  const maxX = Math.max(...bounds.map((item) => item.maxX));
  const minY = Math.min(...bounds.map((item) => item.minY));
  const maxY = Math.max(...bounds.map((item) => item.maxY));
  const minZ = Math.min(...bounds.map((item) => item.minZ));
  const maxZ = Math.max(...bounds.map((item) => item.maxZ));
  return {
    width: Math.round((maxX - minX) * 1000) / 1000,
    height: Math.round((maxY - minY) * 1000) / 1000,
    depth: Math.round((maxZ - minZ) * 1000) / 1000,
  };
}

function migratePart(part, rootAssemblyId, idMap) {
  const id = idMap.get(part.id);
  const common = {
    id,
    legacyId: part.id,
    name: part.name,
    ownerAssemblyId: rootAssemblyId,
    dimensionsMm: {
      x: part.sizeX,
      y: part.sizeY,
      z: part.sizeZ,
    },
    transform: {
      positionMm: [part.xMm, part.yMm, part.zMm],
      rotationDeg: [part.rotationX ?? 0, part.rotationY ?? 0, part.rotationZ ?? 0],
    },
    attachedToEntityId: idMap.get(part.attachedTo) ?? null,
    lockedToEntityId: idMap.get(part.lockedTo) ?? null,
    legacyGroupId: part.groupId ?? null,
  };
  if (part.kind === "hardware") {
    return {
      ...common,
      entityType: "hardware-instance",
      hardwareType: part.hardwareType ?? "unknown",
      catalogProductVersionId: null,
      legacyData: serializeFurnitureDocument(part),
    };
  }
  return {
    ...common,
    entityType: "panel",
    panelType: part.partType ?? null,
    materialRef: { legacyCode: part.material ?? "ldsp-16" },
    faceSide: part.faceSide ?? null,
    frontDirection: part.frontDirection ?? null,
    legacyData: serializeFurnitureDocument(part),
  };
}

export function migrateFurnitureDocument(input, metadata = {}) {
  if (input?.schemaVersion > DOCUMENT_SCHEMA_VERSION) {
    throw new Error(`unsupported_schema_version:${input.schemaVersion}`);
  }
  if (input?.schemaVersion === DOCUMENT_SCHEMA_VERSION) {
    const current = serializeFurnitureDocument(input);
    const validation = validateFurnitureDocument(current);
    if (!validation.valid) {
      const error = new Error("invalid_furniture_document");
      error.violations = validation.violations;
      throw error;
    }
    return current;
  }

  const workspace = input?.model && typeof input.model === "object" ? input : null;
  const model = workspace?.model ?? input;
  if (!model || !Array.isArray(model.parts)) throw new Error("invalid_legacy_model");

  const document = createFurnitureDocument({
    name: metadata.name ?? workspace?.name ?? "Импортированный элемент",
    componentType: metadata.componentType ?? "cabinet",
  });
  const idMap = new Map(model.parts.map((part) => [part.id, createEntityId()]));
  model.parts.forEach((part) => {
    const migrated = migratePart(part, document.rootAssemblyId, idMap);
    if (migrated.entityType === "hardware-instance") {
      document.entities.hardwareInstances.push(migrated);
    } else {
      document.entities.panels.push(migrated);
    }
  });
  document.entities.connections = (model.connections ?? []).map((connection) => ({
    id: createEntityId(),
    legacyId: connection.id,
    entityType: "connection",
    connectionType: connection.type,
    entityIds: (connection.partIds ?? []).map((id) => idMap.get(id)).filter(Boolean),
    insetMm: connection.insetMm ?? null,
    positionsMm: Array.isArray(connection.positionsMm) ? [...connection.positionsMm] : [],
  }));
  document.placement.boundsMm = boundsFor(model.parts);
  document.placement.collisionVolumes = document.placement.boundsMm.width
    ? [{ type: "box", sizeMm: [
      document.placement.boundsMm.width,
      document.placement.boundsMm.height,
      document.placement.boundsMm.depth,
    ] }]
    : [];
  document.legacy = {
    modelState: {
      nextPartNumber: model.nextPartNumber ?? model.parts.length + 1,
      nextConnectionNumber: model.nextConnectionNumber ?? document.entities.connections.length + 1,
      gridStepMm: model.gridStepMm ?? 1,
    },
    editorState: workspace
      ? Object.fromEntries(Object.entries(workspace).filter(([key]) => key !== "model"))
      : {},
  };

  const validation = validateFurnitureDocument(document);
  if (!validation.valid) {
    const error = new Error("legacy_migration_failed");
    error.violations = validation.violations;
    throw error;
  }
  return document;
}
