export class StateCommand {
  constructor({ label = "Изменение", apply, revert, changes = [], inverseChanges = [] }) {
    if (typeof apply !== "function" || typeof revert !== "function") throw new Error("invalid_command");
    this.label = label;
    this.apply = apply;
    this.revert = revert;
    this.changes = changes;
    this.inverseChanges = inverseChanges;
  }

  execute() { return this.apply(); }
  undo() { return this.revert(); }
}

export class SnapshotCommand extends StateCommand {
  constructor({ label, model, before, after, changes = [] }) {
    super({
      label,
      apply: () => model.restore(after),
      revert: () => model.restore(before),
      changes,
      inverseChanges: [{ type: "full-sync" }],
    });
  }
}
