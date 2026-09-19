import test from "node:test";
import assert from "node:assert/strict";

import { CommandManager } from "../src/commands/CommandManager.js";
import { StateCommand } from "../src/commands/commands.js";

test("команда выполняется атомарно и поддерживает undo/redo", () => {
  const state = { value: 0 };
  const manager = new CommandManager({ limit: 10 });
  manager.execute(new StateCommand({ label: "set", apply: () => { state.value = 1; }, revert: () => { state.value = 0; } }));
  assert.equal(state.value, 1);
  manager.undo();
  assert.equal(state.value, 0);
  manager.redo();
  assert.equal(state.value, 1);
});

test("история ограничена и новая команда очищает redo", () => {
  const manager = new CommandManager({ limit: 2 });
  const state = { value: 0 };
  for (let value = 1; value <= 3; value += 1) {
    const before = state.value;
    manager.execute(new StateCommand({ apply: () => { state.value = value; }, revert: () => { state.value = before; } }));
  }
  assert.equal(manager.undoStack.length, 2);
  manager.undo();
  manager.execute(new StateCommand({ apply: () => { state.value = 9; }, revert: () => {} }));
  assert.equal(manager.redoStack.length, 0);
});
