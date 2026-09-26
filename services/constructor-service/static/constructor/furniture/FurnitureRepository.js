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

  async loadRoom(roomId) {
    const roomPayload = await payload(await this.fetch(`${API}/rooms/${roomId}`, { credentials: "include" }));
    const definitionsPayload = await payload(await this.fetch(
      `${API}/definitions?projectId=${encodeURIComponent(roomPayload.room.projectId)}`,
      { credentials: "include" },
    ));
    const definitions = await Promise.all((definitionsPayload.definitions ?? []).map(async (summary) => (
      payload(await this.fetch(`${API}/definitions/${summary.id}`, { credentials: "include" }))
    )));
    return {
      room: roomPayload.room,
      definitions,
      instances: (roomPayload.instances ?? []).map((item) => new FurnitureInstanceModel(item)),
    };
  }

  async saveRoom(roomId, changes) {
    return payload(await this.fetch(`${API}/rooms/${roomId}`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    }));
  }

  async createRoomInstance(roomId, definition) {
    const result = await payload(await this.fetch(`${API}/rooms/${roomId}/instances`, {
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

  async saveRoomInstance(roomId, instance) {
    return payload(await this.fetch(`${API}/rooms/${roomId}/instances/${instance.id}`, {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transform: instance.transform, placement: instance.placement }),
    }));
  }

  async deleteRoomInstance(roomId, instanceId) {
    const response = await this.fetch(`${API}/rooms/${roomId}/instances/${instanceId}`, {
      method: "DELETE", credentials: "include",
    });
    if (!response.ok && response.status !== 204) await payload(response);
  }

}
