import test from "node:test";
import assert from "node:assert/strict";

import { createDrillingOperation } from "../src/manufacturing/operations.js";

test("операция сверления хранит локальные координаты панели и происхождение", () => {
  const operation = createDrillingOperation({
    panelId: "panel-1", face: "front", positionMm: [37, 100], diameterMm: 5, depthMm: 12,
    source: { type: "catalog-mounting-pattern", id: "pattern-v1" },
  });
  assert.equal(operation.coordinateSystem, "panel-local");
  assert.deepEqual(operation.positionMm, [37, 100]);
  assert.deepEqual(operation.source, { type: "catalog-mounting-pattern", id: "pattern-v1" });
  assert.throws(() => createDrillingOperation({ panelId: "panel-1", positionMm: [0, 0] }), /invalid_drilling_operation/);
});
