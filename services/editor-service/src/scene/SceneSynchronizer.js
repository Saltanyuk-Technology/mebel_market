const PRIORITY = { selection: 1, transform: 2, geometry: 3, added: 4, removed: 5, "full-sync": 6 };

export class SceneSynchronizer {
  constructor({ applyChange }) {
    this.applyChange = applyChange;
    this.pending = new Map();
  }

  enqueue(change) {
    const key = change.type === "full-sync" ? "__full__" : change.entityId;
    if (!key) throw new Error("scene_change_entity_required");
    const current = this.pending.get(key);
    if (!current || (PRIORITY[change.type] ?? 0) >= (PRIORITY[current.type] ?? 0)) {
      this.pending.set(key, change);
    }
  }

  flush() {
    const changes = [...this.pending.values()];
    this.pending.clear();
    changes.forEach((change) => this.applyChange(change));
    return changes;
  }
}
