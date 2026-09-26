import { toFurnitureDocument } from "../persistence/documentMapper.js";

const API = "/api/editor";
const DRAFT_PREFIX = "mebel-editor-draft-v2:";

export class ProjectConflictError extends Error {
  constructor(payload) {
    super("stale_base_revision");
    this.payload = payload;
  }
}

async function jsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.status === 409) throw new ProjectConflictError(payload);
  if (!response.ok) {
    const error = new Error(payload.error ?? `request_failed_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export class ProjectService {
  constructor({ fetchImpl = globalThis.fetch, storage = globalThis.localStorage } = {}) {
    this.fetch = fetchImpl;
    this.storage = storage;
    this.currentDocument = null;
  }

  toDocument(workspace, metadata = {}) {
    const next = toFurnitureDocument(workspace, metadata);
    if (!this.currentDocument) return next;
    const previous = this.currentDocument;
    const idMap = new Map([[next.rootAssemblyId, previous.rootAssemblyId]]);
    for (const collection of ["panels", "facades", "hardwareInstances", "connections", "machiningOperations"]) {
      const oldByLegacyId = new Map((previous.entities?.[collection] ?? [])
        .filter((entity) => entity.legacyId != null)
        .map((entity) => [String(entity.legacyId), entity.id]));
      for (const entity of next.entities?.[collection] ?? []) {
        const oldId = entity.legacyId != null ? oldByLegacyId.get(String(entity.legacyId)) : null;
        if (oldId) idMap.set(entity.id, oldId);
      }
    }
    const mapped = structuredClone(next);
    mapped.rootAssemblyId = previous.rootAssemblyId;
    for (const collection of Object.keys(mapped.entities)) {
      for (const entity of mapped.entities[collection] ?? []) {
        entity.id = idMap.get(entity.id) ?? entity.id;
        for (const field of ["ownerAssemblyId", "parentAssemblyId", "attachedToEntityId", "lockedToEntityId", "panelId"]) {
          if (entity[field]) entity[field] = idMap.get(entity[field]) ?? entity[field];
        }
        if (Array.isArray(entity.entityIds)) {
          entity.entityIds = entity.entityIds.map((id) => idMap.get(id) ?? id);
        }
      }
    }
    return mapped;
  }

  toWorkspace(document) {
    const editorState = structuredClone(document.legacy?.editorState ?? {});
    const parts = [
      ...(document.entities?.panels ?? []),
      ...(document.entities?.hardwareInstances ?? []),
    ].map((entity) => structuredClone(entity.legacyData ?? {
      id: entity.legacyId ?? entity.id,
      kind: entity.entityType === "hardware-instance" ? "hardware" : "part",
      name: entity.name,
      sizeX: entity.dimensionsMm?.x, sizeY: entity.dimensionsMm?.y, sizeZ: entity.dimensionsMm?.z,
      xMm: entity.transform?.positionMm?.[0], yMm: entity.transform?.positionMm?.[1], zMm: entity.transform?.positionMm?.[2],
      rotationX: entity.transform?.rotationDeg?.[0], rotationY: entity.transform?.rotationDeg?.[1], rotationZ: entity.transform?.rotationDeg?.[2],
    }));
    const connections = (document.entities?.connections ?? []).map((connection) => ({
      id: connection.legacyId ?? connection.id,
      type: connection.connectionType,
      partIds: connection.entityIds?.map((id) => {
        const entity = [...(document.entities?.panels ?? []), ...(document.entities?.hardwareInstances ?? [])]
          .find((item) => item.id === id);
        return entity?.legacyId ?? id;
      }) ?? [],
      insetMm: connection.insetMm,
      positionsMm: [...(connection.positionsMm ?? [])],
    }));
    return {
      ...editorState,
      model: {
        parts,
        connections,
        nextPartNumber: document.legacy?.modelState?.nextPartNumber ?? parts.length + 1,
        nextConnectionNumber: document.legacy?.modelState?.nextConnectionNumber ?? connections.length + 1,
        gridStepMm: document.legacy?.modelState?.gridStepMm ?? 1,
      },
    };
  }

  async load(definitionId) {
    const payload = await jsonResponse(await this.fetch(`${API}/definitions/${definitionId}`, { credentials: "include" }));
    if (!payload.revision?.document) throw new Error("definition_has_no_revision");
    this.currentDocument = structuredClone(payload.revision.document);
    return { ...payload, workspace: this.toWorkspace(payload.revision.document) };
  }

  async save({ definitionId, basedOnRevisionId, name, componentType = "cabinet", workspace, projectId }) {
    const document = this.toDocument(workspace, { name, componentType });
    const body = { name, componentType, document, placementMetadata: document.placement, projectId };
    const url = definitionId ? `${API}/definitions/${definitionId}/revisions` : `${API}/definitions`;
    if (definitionId) body.basedOnRevisionId = basedOnRevisionId;
    const result = await jsonResponse(await this.fetch(url, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    this.currentDocument = structuredClone(document);
    return result;
  }

  async listLibrary() {
    return (await jsonResponse(await this.fetch(`${API}/library`, { credentials: "include" }))).items;
  }

  async addToLibrary(definitionId, name) {
    return jsonResponse(await this.fetch(`${API}/library`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definitionId, name }),
    }));
  }

  async copyLibraryToProject(itemId, projectId) {
    return jsonResponse(await this.fetch(`${API}/library/${itemId}/copy-to-project`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    }));
  }

  saveDraft(id, workspace) {
    try { this.storage?.setItem(`${DRAFT_PREFIX}${id}`, JSON.stringify(workspace)); } catch { /* local fallback is best effort */ }
  }

  loadDraft(id) {
    try { return JSON.parse(this.storage?.getItem(`${DRAFT_PREFIX}${id}`)) ?? null; } catch { return null; }
  }
}
