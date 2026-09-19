import test from "node:test";
import assert from "node:assert/strict";

import { RuleEngine } from "../src/rules/RuleEngine.js";
import { createCoreRules } from "../src/rules/coreRules.js";
import { createFurnitureDocument } from "../src/domain/document.js";

test("движок правил различает ошибки и предупреждения", () => {
  const engine = new RuleEngine([
    { id: "warning", evaluate: () => [{ code: "NOTICE", severity: "warning" }] },
    { id: "error", evaluate: () => [{ code: "BLOCKED", severity: "error" }] },
  ]);
  const result = engine.validate({ document: {}, operation: "save", affectedEntityIds: [] });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.warnings.length, 1);
});

test("базовые правила сообщают о неизвестном материале, не привязываясь к бренду", () => {
  const document = createFurnitureDocument();
  document.entities.panels.push({
    id: crypto.randomUUID(), ownerAssemblyId: document.rootAssemblyId,
    dimensionsMm: { x: 600, y: 16, z: 400 }, materialRef: {},
  });
  const result = new RuleEngine(createCoreRules()).validate({ document, operation: "save" });
  assert.equal(result.violations.some((item) => item.code === "MATERIAL_REFERENCE_REQUIRED"), true);
});
