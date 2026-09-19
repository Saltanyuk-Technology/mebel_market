import test from "node:test";
import assert from "node:assert/strict";

import { migrateFurnitureDocument } from "../src/persistence/migrations.js";
import { serializeFurnitureDocument } from "../src/persistence/serialize.js";
import { validateFurnitureDocument } from "../src/domain/validation.js";

function legacyModel() {
  return {
    parts: [
      {
        id: "part-1", kind: "part", name: "Дно", partType: "bottom", material: "ldsp-16",
        sizeX: 600, sizeY: 16, sizeZ: 400, xMm: 0, yMm: 100, zMm: 0,
        rotationX: 0, rotationY: 0, rotationZ: 0,
      },
      {
        id: "part-2", kind: "hardware", hardwareType: "leg", name: "Ножка",
        sizeX: 57, sizeY: 100, sizeZ: 57, xMm: -200, yMm: 0, zMm: -100,
        rotationX: 0, rotationY: 0, rotationZ: 0, attachedTo: "part-1", lockedTo: "part-1",
      },
    ],
    connections: [{ id: "connection-1", type: "confirmat", partIds: ["part-1", "part-2"] }],
    nextPartNumber: 3,
    nextConnectionNumber: 2,
    gridStepMm: 1,
  };
}

test("старая модель превращается в один корневой документ схемы 2", () => {
  const document = migrateFurnitureDocument(legacyModel(), {
    name: "Нижний шкаф",
    componentType: "base-cabinet",
  });

  assert.equal(document.schemaVersion, 2);
  assert.equal(document.entities.assemblies.length, 1);
  assert.equal(document.entities.panels.length, 1);
  assert.equal(document.entities.hardwareInstances.length, 1);
  assert.equal(document.entities.panels[0].legacyId, "part-1");
  assert.equal(document.entities.panels[0].ownerAssemblyId, document.rootAssemblyId);
  assert.equal(document.entities.hardwareInstances[0].attachedToEntityId, document.entities.panels[0].id);
  assert.deepEqual(document.entities.connections[0].entityIds, [
    document.entities.panels[0].id,
    document.entities.hardwareInstances[0].id,
  ]);
  assert.equal(validateFurnitureDocument(document).valid, true);
  assert.deepEqual(document.placement.boundsMm, { width: 600, height: 116, depth: 400 });
});

test("миграция принимает старое рабочее пространство с полем model", () => {
  const document = migrateFurnitureDocument({ model: legacyModel(), selectedIds: ["part-1"] });
  assert.equal(document.entities.panels.length, 1);
  assert.equal(document.legacy.editorState.selectedIds[0], "part-1");
});

test("будущая неизвестная версия схемы отклоняется", () => {
  assert.throws(
    () => migrateFurnitureDocument({ schemaVersion: 999 }),
    /unsupported_schema_version:999/,
  );
});

test("сериализация создаёт независимую JSON-безопасную копию", () => {
  const document = migrateFurnitureDocument(legacyModel());
  const serialized = serializeFurnitureDocument(document);
  serialized.metadata.name = "Изменено";

  assert.notEqual(document.metadata.name, serialized.metadata.name);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)), serialized);
  assert.deepEqual(serializeFurnitureDocument(migrateFurnitureDocument(serialized)), serialized);
});
