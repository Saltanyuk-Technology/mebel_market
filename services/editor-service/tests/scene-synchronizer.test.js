import test from "node:test";
import assert from "node:assert/strict";

import { SceneSynchronizer } from "../src/scene/SceneSynchronizer.js";

test("несколько изменений одной сущности объединяются в одно обновление", () => {
  const applied = [];
  const synchronizer = new SceneSynchronizer({ applyChange: (change) => applied.push(change) });
  synchronizer.enqueue({ type: "transform", entityId: "panel-1", transform: { x: 10 } });
  synchronizer.enqueue({ type: "transform", entityId: "panel-1", transform: { x: 20 } });
  synchronizer.flush();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].transform.x, 20);
});

test("удаление имеет приоритет над предыдущим изменением геометрии", () => {
  const applied = [];
  const synchronizer = new SceneSynchronizer({ applyChange: (change) => applied.push(change) });
  synchronizer.enqueue({ type: "geometry", entityId: "panel-1" });
  synchronizer.enqueue({ type: "removed", entityId: "panel-1" });
  synchronizer.flush();
  assert.deepEqual(applied, [{ type: "removed", entityId: "panel-1" }]);
});
