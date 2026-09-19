import test from "node:test";
import assert from "node:assert/strict";

import { createFurnitureDocument } from "../src/domain/document.js";
import { validateFurnitureDocument } from "../src/domain/validation.js";

test("новый документ имеет схему 2 и ровно одну корневую сборку", () => {
  const document = createFurnitureDocument({
    name: "Нижний шкаф 600",
    componentType: "base-cabinet",
  });

  assert.equal(document.schemaVersion, 2);
  assert.equal(document.documentType, "furniture-definition");
  assert.equal(document.metadata.name, "Нижний шкаф 600");
  assert.equal(document.metadata.componentType, "base-cabinet");
  assert.equal(document.entities.assemblies.length, 1);
  assert.equal(document.entities.assemblies[0].id, document.rootAssemblyId);
  assert.equal(document.entities.assemblies[0].parentAssemblyId, null);
  assert.deepEqual(validateFurnitureDocument(document), { valid: true, violations: [] });
});

test("валидатор отклоняет панель вне дерева корневой сборки", () => {
  const document = createFurnitureDocument({ name: "Шкаф" });
  document.entities.panels.push({
    id: crypto.randomUUID(),
    entityType: "panel",
    ownerAssemblyId: crypto.randomUUID(),
  });

  const result = validateFurnitureDocument(document);

  assert.equal(result.valid, false);
  assert.equal(result.violations[0].code, "ORPHAN_ENTITY");
  assert.deepEqual(result.violations[0].entityIds, [document.entities.panels[0].id]);
});

test("валидатор отклоняет вторую корневую сборку", () => {
  const document = createFurnitureDocument({ name: "Два шкафа" });
  const secondRootId = crypto.randomUUID();
  document.entities.assemblies.push({
    id: secondRootId,
    entityType: "assembly",
    assemblyType: "cabinet",
    parentAssemblyId: null,
  });

  const result = validateFurnitureDocument(document);

  assert.equal(result.valid, false);
  assert.equal(result.violations.some((item) => item.code === "MULTIPLE_ROOT_ASSEMBLIES"), true);
});

test("валидатор отклоняет цикл вложенных сборок", () => {
  const document = createFurnitureDocument({ name: "Цикл" });
  const childId = crypto.randomUUID();
  document.entities.assemblies.push({
    id: childId,
    entityType: "assembly",
    assemblyType: "drawer",
    parentAssemblyId: document.rootAssemblyId,
  });
  document.entities.assemblies[0].parentAssemblyId = childId;

  const result = validateFurnitureDocument(document);

  assert.equal(result.valid, false);
  assert.equal(result.violations.some((item) => item.code === "ASSEMBLY_CYCLE"), true);
});
