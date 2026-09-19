import test from "node:test";
import assert from "node:assert/strict";

import { previewRevisionUpdate } from "../src/instances/update.js";

const revision = (id, width) => ({
  id,
  document: { placement: { boundsMm: { width, height: 720, depth: 560 } } },
});

test("обновление ширины сохраняет заднюю левую опорную точку", () => {
  const instance = {
    id: "one", revisionId: "old", transform: { positionMm: [100, 0, 200] },
    placement: { anchor: "back-left-bottom" },
  };
  const result = previewRevisionUpdate({
    instance, currentRevision: revision("old", 600), nextRevision: revision("new", 800),
    room: null, neighbors: [],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.nextTransform.positionMm, [100, 0, 200]);
});

test("столкновение отклоняет новую ревизию и не меняет экземпляр", () => {
  const instance = {
    id: "one", revisionId: "old", transform: { positionMm: [0, 0, 0] },
    placement: { anchor: "back-left-bottom" },
  };
  const before = structuredClone(instance);
  const result = previewRevisionUpdate({
    instance, currentRevision: revision("old", 400), nextRevision: revision("new", 800),
    room: null,
    neighbors: [{ id: "two", transform: { positionMm: [600, 0, 0] }, boundsMm: { width: 400, height: 720, depth: 560 } }],
  });
  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "INSTANCE_COLLISION");
  assert.deepEqual(instance, before);
});
