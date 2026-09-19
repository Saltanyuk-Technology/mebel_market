import test from "node:test";
import assert from "node:assert/strict";

import { ProjectConflictError, ProjectService } from "../src/application/ProjectService.js";

function workspace() {
  return { model: { parts: [{ id: "part-1", kind: "part", sizeX: 600, sizeY: 16, sizeZ: 400, xMm: 0, yMm: 0, zMm: 0 }], connections: [] }, selectedIds: ["part-1"] };
}

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("новый проект сохраняется как определение и первая ревизия", async () => {
  const calls = [];
  const service = new ProjectService({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(201, { definition: { id: "definition-1", name: "Шкаф" }, revision: { id: "revision-1", revisionNumber: 1 } });
  } });
  const saved = await service.save({ name: "Шкаф", workspace: workspace() });
  assert.equal(calls[0].url, "/api/editor/definitions");
  assert.equal(JSON.parse(calls[0].options.body).document.schemaVersion, 2);
  assert.equal(saved.revision.id, "revision-1");
});

test("существующий проект создаёт новую ревизию и сообщает о конфликте", async () => {
  const service = new ProjectService({ fetchImpl: async () => response(409, { error: "stale_base_revision" }) });
  await assert.rejects(
    service.save({ definitionId: "definition-1", basedOnRevisionId: "old", workspace: workspace() }),
    ProjectConflictError,
  );
});

test("загрузка текущего документа восстанавливает старую модель редактора", async () => {
  const createService = new ProjectService({ fetchImpl: async () => response(500, {}) });
  const document = createService.toDocument(workspace(), { name: "Шкаф" });
  const service = new ProjectService({ fetchImpl: async () => response(200, {
    definition: { id: "definition-1", name: "Шкаф", latestRevisionId: "revision-1" },
    revision: { id: "revision-1", document },
  }) });
  const loaded = await service.load("definition-1");
  assert.equal(loaded.workspace.model.parts[0].id, "part-1");
  assert.deepEqual(loaded.workspace.selectedIds, ["part-1"]);
});

test("локальный черновик работает без сети", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const service = new ProjectService({ fetchImpl: async () => { throw new Error("offline"); }, storage });
  service.saveDraft("draft-1", workspace());
  assert.equal(service.loadDraft("draft-1").model.parts.length, 1);
});

test("UUID сущностей остаются стабильными между ревизиями", async () => {
  const bodies = [];
  let call = 0;
  const service = new ProjectService({ fetchImpl: async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    call += 1;
    return response(201, call === 1
      ? { definition: { id: "definition-1", name: "Шкаф" }, revision: { id: "revision-1" } }
      : { revision: { id: "revision-2" } });
  } });
  await service.save({ name: "Шкаф", workspace: workspace() });
  await service.save({ definitionId: "definition-1", basedOnRevisionId: "revision-1", name: "Шкаф", workspace: workspace() });
  assert.equal(bodies[0].document.rootAssemblyId, bodies[1].document.rootAssemblyId);
  assert.equal(bodies[0].document.entities.panels[0].id, bodies[1].document.entities.panels[0].id);
});
