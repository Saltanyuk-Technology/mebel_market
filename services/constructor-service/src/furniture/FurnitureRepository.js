import { FurnitureInstanceModel } from "./FurnitureInstanceModel.js";

const API = "/api/editor";

async function payload(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error ?? `request_failed_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export class FurnitureRepository {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetch = fetchImpl;
  }

  async loadKitchen(kitchenId) {
    const [kitchenPayload, definitionsPayload, libraryPayload] = await Promise.all([
      this.fetch(`${API}/kitchens/${kitchenId}`, { credentials: "include" }).then(payload),
      this.fetch(`${API}/definitions?kitchenProjectId=${encodeURIComponent(kitchenId)}`, { credentials: "include" }).then(payload),
      this.fetch(`${API}/library`, { credentials: "include" }).then(payload),
    ]);
    const projectDefinitions = await Promise.all((definitionsPayload.definitions ?? []).map(async (summary) => {
      const detail = await payload(await this.fetch(`${API}/definitions/${summary.id}`, { credentials: "include" }));
      return detail;
    }));
    const known = new Set(projectDefinitions.map((item) => item.definition.id));
    const libraryDefinitions = (libraryPayload.items ?? [])
      .filter((item) => item.document && !known.has(item.definitionId))
      .map((item) => ({
        definition: { id: item.definitionId, name: item.name, latestRevisionId: item.latestRevisionId, scope: "library" },
        revision: { id: item.latestRevisionId, document: item.document },
        libraryEntryId: item.id,
      }));
    return {
      kitchen: kitchenPayload.kitchen,
      definitions: [...projectDefinitions, ...libraryDefinitions],
      instances: (kitchenPayload.instances ?? []).map((item) => new FurnitureInstanceModel(item)),
    };
  }

  async saveKitchen(kitchenId, changes) {
    return payload(await this.fetch(`${API}/kitchens/${kitchenId}`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    }));
  }

  async createInstance(kitchenId, definition) {
    const result = await payload(await this.fetch(`${API}/kitchens/${kitchenId}/instances`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        definitionId: definition.definition.id,
        revisionId: definition.revision.id,
        transform: { positionMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
        placement: { anchor: "back-left-bottom" },
      }),
    }));
    return new FurnitureInstanceModel(result.instance);
  }

  async previewUpdate(kitchenId, instanceId, revisionId) {
    return payload(await this.fetch(`${API}/kitchens/${kitchenId}/instances/${instanceId}/revision-preview`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId }),
    }));
  }

  async applyUpdate(kitchenId, instanceId, revisionId) {
    return payload(await this.fetch(`${API}/kitchens/${kitchenId}/instances/${instanceId}/revision`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId }),
    }));
  }

  async saveInstance(kitchenId, instance) {
    return payload(await this.fetch(`${API}/kitchens/${kitchenId}/instances/${instance.id}`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transform: instance.transform, placement: instance.placement }),
    }));
  }

  async deleteInstance(kitchenId, instanceId) {
    const response = await this.fetch(`${API}/kitchens/${kitchenId}/instances/${instanceId}`, {
      method: "DELETE", credentials: "include",
    });
    if (!response.ok && response.status !== 204) await payload(response);
  }
}
