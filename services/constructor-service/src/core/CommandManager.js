export class CommandManager {
  constructor(onChange) {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = onChange;
  }

  execute(command) {
    if (command.execute() === false) {
      this.onChange?.();
      return false;
    }
    this.undoStack.push(command);
    this.redoStack.length = 0;
    this.onChange?.();
    return true;
  }

  pushExecuted(command) {
    this.undoStack.push(command);
    this.redoStack.length = 0;
    this.onChange?.();
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
    this.onChange?.();
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return;
    command.redo();
    this.undoStack.push(command);
    this.onChange?.();
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.onChange?.();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
