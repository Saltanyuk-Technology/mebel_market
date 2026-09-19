import test from "node:test";
import assert from "node:assert/strict";

import { FurnitureInstanceModel } from "../src/furniture/FurnitureInstanceModel.js";
import { FurnitureRepository } from "../src/furniture/FurnitureRepository.js";

test("экземпляр хранит только ссылку на ревизию и трансформацию", () => {
  const instance = new FurnitureInstanceModel({
    id: "instance-1", definitionId: "definition-1", revisionId: "revision-1",
    transform: { positionMm: [100, 0, 200], rotationDeg: [0, 90, 0] },
  });
  assert.equal(instance.definitionId, "definition-1");
  assert.equal(instance.revisionId, "revision-1");
  assert.equal(instance.parts, undefined);
  instance.moveTo({ xMm: 300, zMm: 400, rotationY: 45 });
  assert.deepEqual(instance.transform.positionMm, [300, 0, 400]);
  assert.deepEqual(instance.transform.rotationDeg, [0, 45, 0]);
});

test("репозиторий загружает кухню, определения и неизменяемые экземпляры", async () => {
  const fetchImpl = async (url) => {
    if (url === "/api/editor/kitchens/kitchen-1") return response(200, { kitchen: { id: "kitchen-1" }, instances: [{ id: "i1", definitionId: "d1", revisionId: "r1", transform: {} }] });
    if (url.includes("/definitions?")) return response(200, { definitions: [{ id: "d1" }] });
    if (url === "/api/editor/definitions/d1") return response(200, { definition: { id: "d1", name: "Шкаф" }, revision: { id: "r1", document: { entities: { panels: [] } } } });
    if (url === "/api/editor/library") return response(200, { items: [{ id: "l1", definitionId: "d2", latestRevisionId: "r2", name: "Шкаф из библиотеки", document: { entities: { panels: [] } } }] });
    throw new Error(url);
  };
  const result = await new FurnitureRepository({ fetchImpl }).loadKitchen("kitchen-1");
  assert.equal(result.definitions[0].revision.id, "r1");
  assert.equal(result.definitions[1].definition.id, "d2");
  assert.equal(result.instances[0].id, "i1");
});

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
