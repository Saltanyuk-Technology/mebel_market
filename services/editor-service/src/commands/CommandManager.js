export class CommandManager {
  constructor({ limit = 100, onChange = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("invalid_history_limit");
    this.limit = limit;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
  }

  execute(command) {
    const result = command.execute();
    if (result === false) return false;
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    this.redoStack.length = 0;
    this.onChange?.(command.changes ?? []);
    return result ?? true;
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo();
    this.redoStack.push(command);
    this.onChange?.(command.inverseChanges ?? []);
    return true;
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.execute();
    this.undoStack.push(command);
    this.onChange?.(command.changes ?? []);
    return true;
  }
}
