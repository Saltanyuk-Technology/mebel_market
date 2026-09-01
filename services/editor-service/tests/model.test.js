import test from "node:test";
import assert from "node:assert/strict";
import {
  FurnitureModel,
  constrainMeasurementPoint,
  getConfirmatPlacement,
  getPartAabb,
  History,
} from "../src/model.js";

test("Shift фиксирует вторую точку линейки по доминирующей оси", () => {
  const start = { xMm: 10, yMm: 20, zMm: 30 };
  assert.deepEqual(
    constrainMeasurementPoint(start, { xMm: 210, yMm: 45, zMm: 70 }),
    { xMm: 210, yMm: 20, zMm: 30 },
  );
  assert.deepEqual(
    constrainMeasurementPoint(start, { xMm: 25, yMm: 320, zMm: 50 }),
    { xMm: 10, yMm: 320, zMm: 30 },
  );
  assert.deepEqual(
    constrainMeasurementPoint(start, { xMm: 20, yMm: 40, zMm: -270 }),
    { xMm: 10, yMm: 20, zMm: -270 },
  );
});

test("конфирмат перемещается только вдоль торца и остаётся на его центральной линии", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({ lengthMm: 600, widthMm: 470, partType: "bottom" });
  const side = model.addCustomPart({ lengthMm: 720, widthMm: 470, partType: "side" });
  model.updatePart(bottom.id, { xMm: 0, yMm: 0, zMm: 0 });
  model.updatePart(side.id, {
    xMm: 292,
    yMm: 16,
    zMm: 0,
    rotationZ: 90,
  });
  const connection = model.connectParts([bottom.id, side.id], "confirmat", 60);

  assert.equal(model.moveConfirmat(connection.id, 0, 25), 25);
  let placement = getConfirmatPlacement(model, connection);
  assert.deepEqual(placement.points[0], { xMm: 292, yMm: 0, zMm: 25 });
  assert.equal(placement.spanAxis, "z");
  assert.equal(placement.fixedAxis, "x");
  assert.equal(placement.fixedValue, 292);

  assert.equal(model.moveConfirmat(connection.id, 0, 1000), 229);
  placement = getConfirmatPlacement(model, connection);
  assert.deepEqual(placement.points[0], { xMm: 292, yMm: 0, zMm: 229 });
});

test("перед стоящей боковины автоматически совпадает с передом соединённого дна", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({ lengthMm: 600, widthMm: 470, partType: "bottom" });
  const side = model.addCustomPart({ lengthMm: 720, widthMm: 470, partType: "side" });
  model.updatePart(bottom.id, {
    xMm: 0,
    yMm: 0,
    zMm: 0,
    frontDirection: "z-",
  });
  model.updatePart(side.id, {
    xMm: 292,
    yMm: 16,
    zMm: 0,
    rotationZ: 90,
    frontDirection: "z+",
  });

  model.connectParts([bottom.id, side.id], "confirmat", 60);
  assert.equal(side.frontDirection, "z-");

  model.updatePart(bottom.id, { frontDirection: "z+" });
  assert.equal(side.frontDirection, "z+");

  model.updatePart(side.id, { frontDirection: "z-" });
  assert.equal(side.frontDirection, "z+");
});

test("две соприкасающиеся детали соединяются двумя конфирматами с отступом 60 мм", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({ lengthMm: 600, widthMm: 470 });
  const side = model.addCustomPart({ lengthMm: 600, widthMm: 470 });
  model.updatePart(bottom.id, {
    partType: "bottom",
    xMm: 0,
    yMm: 0,
    zMm: 0,
  });
  model.updatePart(side.id, {
    partType: "side",
    xMm: 292,
    yMm: 16,
    zMm: 0,
    rotationZ: 90,
  });

  const connection = model.connectParts([bottom.id, side.id], "confirmat", 60);
  const placement = getConfirmatPlacement(model, connection);

  assert.equal(connection.type, "confirmat");
  assert.equal(connection.insetMm, 60);
  assert.equal(placement.headPartId, bottom.id);
  assert.equal(placement.axis, "y");
  assert.equal(placement.outerSide, -1);
  assert.deepEqual(
    placement.points.map(({ xMm, yMm, zMm }) => ({ xMm, yMm, zMm })),
    [
      { xMm: 292, yMm: 0, zMm: -175 },
      { xMm: 292, yMm: 0, zMm: 175 },
    ],
  );
  assert.deepEqual(model.toJSON().connections, [connection]);
});

test("конфирматы нельзя добавить между деталями без общего стыка", () => {
  const model = new FurnitureModel();
  const first = model.addCustomPart({ lengthMm: 300, widthMm: 300 });
  const second = model.addCustomPart({ lengthMm: 300, widthMm: 300 });
  model.updatePart(second.id, { xMm: 1000 });

  assert.equal(model.connectParts([first.id, second.id]), false);
  assert.deepEqual(model.connections, []);
});

test("соединённые конфирматами детали перемещаются как единая жёсткая сборка", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({ lengthMm: 600, widthMm: 470 });
  const side = model.addCustomPart({ lengthMm: 600, widthMm: 470 });
  model.updatePart(bottom.id, { partType: "bottom", xMm: 0, yMm: 0, zMm: 0 });
  model.updatePart(side.id, {
    partType: "side",
    xMm: 292,
    yMm: 16,
    zMm: 0,
    rotationZ: 90,
  });
  model.connectParts([bottom.id, side.id], "confirmat", 60);

  const result = model.movePartConstrained(side.id, {
    xMm: side.xMm + 125,
    yMm: side.yMm + 40,
    zMm: side.zMm - 75,
  });

  assert.equal(result.moved, true);
  assert.deepEqual(
    { xMm: bottom.xMm, yMm: bottom.yMm, zMm: bottom.zMm },
    { xMm: 125, yMm: 40, zMm: -75 },
  );
  assert.deepEqual(
    { xMm: side.xMm, yMm: side.yMm, zMm: side.zMm },
    { xMm: 417, yMm: 56, zMm: -75 },
  );
  assert.equal(model.movePartConstrained(side.id, { rotationY: 90 }), false);
});

test("после удаления конфирматов детали снова перемещаются независимо", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({ lengthMm: 600, widthMm: 470 });
  const side = model.addCustomPart({ lengthMm: 600, widthMm: 470 });
  model.updatePart(bottom.id, { partType: "bottom", xMm: 0, yMm: 0, zMm: 0 });
  model.updatePart(side.id, {
    partType: "side",
    xMm: 292,
    yMm: 16,
    zMm: 0,
    rotationZ: 90,
  });
  const connection = model.connectParts([bottom.id, side.id], "confirmat", 60);

  assert.equal(model.deleteConnection(connection.id).id, connection.id);
  assert.equal(model.connections.length, 0);
  assert.equal(model.movePartConstrained(side.id, { xMm: 392 }).moved, true);
  assert.equal(bottom.xMm, 0);
  assert.equal(side.xMm, 392);
});

test("мебельная панель создаётся в миллиметрах", () => {
  const model = new FurnitureModel();
  const part = model.addPart("shelf");
  assert.equal(model.gridStepMm, 1);
  assert.deepEqual(
    { x: part.sizeX, y: part.sizeY, z: part.sizeZ },
    { x: 600, y: 16, z: 400 },
  );
});

test("деталь из ЛДСП получает заданные длину, ширину и толщину 16 мм", () => {
  const model = new FurnitureModel();
  const part = model.addCustomPart({ material: "ldsp-16", lengthMm: 735, widthMm: 418 });
  assert.equal(part.material, "ldsp-16");
  assert.equal(part.materialName, "ЛДСП 16 мм");
  assert.equal(part.sizeX, 735);
  assert.equal(part.sizeY, 16);
  assert.equal(part.sizeZ, 418);
  assert.equal(part.partType, "shelf");
});

test("тип новой детали сразу определяет её название и начальную ориентацию", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({
    partType: "bottom",
    lengthMm: 600,
    widthMm: 470,
  });
  const side = model.addCustomPart({
    partType: "side",
    lengthMm: 720,
    widthMm: 470,
  });
  const bottomBounds = getPartAabb(bottom);
  const sideBounds = getPartAabb(side);

  assert.equal(bottom.name, "Дно 1");
  assert.equal(bottom.partType, "bottom");
  assert.equal(bottom.rotationZ, 0);
  assert.equal(Math.round(bottomBounds.maxY - bottomBounds.minY), 16);

  assert.equal(side.name, "Боковина 2");
  assert.equal(side.partType, "side");
  assert.equal(side.rotationZ, 90);
  assert.equal(Math.round(sideBounds.maxX - sideBounds.minX), 16);
  assert.equal(Math.round(sideBounds.maxY - sideBounds.minY), 720);
  assert.equal(Math.round(sideBounds.maxZ - sideBounds.minZ), 470);
});

test("новая деталь появляется в свободном месте и не пересекает существующую сборку", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({ lengthMm: 600, widthMm: 470 });
  model.updatePart(bottom.id, { partType: "bottom" });
  model.placeBottomLegs(bottom.id, 40);

  const added = model.addCustomPart({ lengthMm: 600, widthMm: 470 });
  const addedBounds = getPartAabb(added);
  model.parts.filter((part) => part.id !== added.id).forEach((part) => {
    const bounds = getPartAabb(part);
    const overlapsOnFloor = Math.min(addedBounds.maxX, bounds.maxX) - Math.max(addedBounds.minX, bounds.minX) > 0.01
      && Math.min(addedBounds.maxZ, bounds.maxZ) - Math.max(addedBounds.minZ, bounds.minZ) > 0.01;
    assert.equal(overlapsOnFloor, false);
  });
});

test("мебельные детали нельзя переместить друг сквозь друга", () => {
  const model = new FurnitureModel();
  const first = model.addCustomPart({ lengthMm: 200, widthMm: 200 });
  const second = model.addCustomPart({ lengthMm: 200, widthMm: 200 });
  const before = { xMm: second.xMm, yMm: second.yMm, zMm: second.zMm };

  const result = model.movePartConstrained(second.id, {
    xMm: first.xMm,
    yMm: first.yMm,
    zMm: first.zMm,
  });
  assert.equal(result, false);
  assert.deepEqual(
    { xMm: second.xMm, yMm: second.yMm, zMm: second.zMm },
    before,
  );
});

test("при сближении детали стыкуются краями и углами", () => {
  const model = new FurnitureModel();
  const first = model.addCustomPart({ lengthMm: 200, widthMm: 200 });
  const edgePart = model.addCustomPart({ lengthMm: 200, widthMm: 200 });
  const cornerPart = model.addCustomPart({ lengthMm: 200, widthMm: 200 });

  const edgeResult = model.movePartConstrained(edgePart.id, { xMm: 209, zMm: 0 });
  assert.equal(edgeResult.moved, true);
  assert.equal(edgePart.xMm, 200);
  assert.equal(edgePart.zMm, 0);

  const cornerResult = model.movePartConstrained(cornerPart.id, { xMm: 209, zMm: 209 });
  assert.equal(cornerResult.moved, true);
  assert.equal(cornerPart.xMm, 200);
  assert.equal(cornerPart.zMm, 200);
});

test("деталь из ХДФ получает фиксированную толщину 4 мм", () => {
  const model = new FurnitureModel();
  const part = model.addCustomPart({ material: "hdf-4", lengthMm: 735, widthMm: 418 });

  assert.equal(part.material, "hdf-4");
  assert.equal(part.materialName, "ХДФ 4 мм");
  assert.equal(part.sizeY, 4);
  assert.equal(part.partType, null);
  assert.match(part.name, /^ХДФ /);
  model.updatePart(part.id, { sizeY: 20, partType: "shelf" });
  assert.equal(part.sizeY, 4);
  assert.equal(part.partType, null);
});

test("на планке 70 мм с отступом 30 мм ставится один конфирмат по центру", () => {
  const model = new FurnitureModel();
  const rail = model.addCustomPart({ lengthMm: 600, widthMm: 70 });
  const side = model.addCustomPart({ lengthMm: 600, widthMm: 70 });
  model.updatePart(rail.id, { partType: "bottom", xMm: 0, yMm: 0, zMm: 0 });
  model.updatePart(side.id, {
    partType: "side",
    xMm: 292,
    yMm: 16,
    zMm: 0,
    rotationZ: 90,
  });

  const connection = model.connectParts([rail.id, side.id], "confirmat", 30);
  const placement = getConfirmatPlacement(model, connection);

  assert.equal(placement.points.length, 1);
  assert.equal(placement.values[0], 0);
  assert.deepEqual(connection.positionsMm, [0]);
});

test("стоящая боковина стыкуется с внешними гранями дна заподлицо", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({ lengthMm: 600, widthMm: 470, partType: "bottom" });
  const side = model.addCustomPart({ lengthMm: 720, widthMm: 470, partType: "side" });
  model.updatePart(bottom.id, { xMm: 0, yMm: 0, zMm: 0 });
  model.updatePart(side.id, { xMm: 500, yMm: 16, zMm: 80, rotationZ: 90 });

  const result = model.movePartConstrained(side.id, { xMm: 300, zMm: 16 });
  const bottomBounds = getPartAabb(bottom);
  const sideBounds = getPartAabb(side);

  assert.equal(result.moved, true);
  assert.equal(side.xMm, 292);
  assert.equal(side.zMm, 0);
  assert.equal(sideBounds.maxX, bottomBounds.maxX);
  assert.equal(sideBounds.minZ, bottomBounds.minZ);
  assert.equal(sideBounds.maxZ, bottomBounds.maxZ);
});

test("детали можно назначить тип дно, боковина, полка или крыша", () => {
  const model = new FurnitureModel();
  const part = model.addCustomPart();
  for (const partType of ["bottom", "side", "shelf", "top"]) {
    model.updatePart(part.id, { partType });
    assert.equal(part.partType, partType);
  }
});

test("у детали сохраняются лицевая сторона и направление вперёд", () => {
  const model = new FurnitureModel();
  const part = model.addCustomPart();
  model.updatePart(part.id, { faceSide: -1, frontDirection: "z+" });
  const saved = model.toJSON();

  const restored = new FurnitureModel();
  restored.restore(saved);
  assert.equal(restored.getPart(part.id).faceSide, -1);
  assert.equal(restored.getPart(part.id).frontDirection, "z+");
});

test("повторный выбор лицевой стороны может снять её назначение", () => {
  const model = new FurnitureModel();
  const part = model.addCustomPart();
  model.updatePart(part.id, { faceSide: 1 });
  assert.equal(part.faceSide, 1);
  model.updatePart(part.id, { faceSide: null });
  assert.equal(part.faceSide, null);
});

test("ножка добавляется как отдельная фурнитура", () => {
  const model = new FurnitureModel();
  const leg = model.addLeg();
  assert.equal(leg.kind, "hardware");
  assert.equal(leg.hardwareType, "leg");
  assert.equal(leg.sizeX, 57);
  assert.equal(leg.sizeY, 100);
  assert.equal(leg.sizeZ, 57);
});

test("ножка прилипает к нижней стороне детали и следует за ней", () => {
  const model = new FurnitureModel();
  const panel = model.addCustomPart({ lengthMm: 600, widthMm: 400 });
  model.updatePart(panel.id, { yMm: 100 });
  const leg = model.addLeg();

  const result = model.movePartConstrained(leg.id, { xMm: 0, yMm: 12, zMm: 0 });
  assert.equal(result.snappedTo, panel.id);
  assert.equal(leg.attachedTo, panel.id);
  assert.equal(leg.yMm, 0);

  model.movePartConstrained(panel.id, { xMm: 50, yMm: 120, zMm: -25 });
  assert.deepEqual(
    { xMm: leg.xMm, yMm: leg.yMm, zMm: leg.zMm },
    { xMm: 50, yMm: 20, zMm: -25 },
  );
});

test("прикреплённая ножка упирается в пол и останавливает опускание детали", () => {
  const model = new FurnitureModel();
  const panel = model.addCustomPart({ lengthMm: 600, widthMm: 400 });
  model.updatePart(panel.id, { yMm: 120 });
  const leg = model.addLeg();
  model.movePartConstrained(leg.id, { xMm: 0, yMm: 20, zMm: 0 });

  model.movePartConstrained(panel.id, { yMm: 40 });
  assert.equal(panel.yMm, 100);
  assert.equal(leg.yMm, 0);
  assert.equal(leg.attachedTo, panel.id);
});

test("четыре ножки автоматически размещаются на дне с заданным отступом и закрепляются", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({ lengthMm: 600, widthMm: 400 });
  model.updatePart(bottom.id, { partType: "bottom" });

  const legs = model.placeBottomLegs(bottom.id, 40);
  assert.equal(legs.length, 4);
  assert.equal(bottom.yMm, 100);
  assert.deepEqual(
    legs.map((leg) => [leg.xMm, leg.zMm]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    [[-231.5, -131.5], [-231.5, 131.5], [231.5, -131.5], [231.5, 131.5]],
  );
  assert.equal(new Set(legs.map((leg) => leg.groupId)).size, 1);
  legs.forEach((leg) => {
    assert.equal(leg.yMm, 0);
    assert.equal(leg.attachedTo, bottom.id);
    assert.equal(leg.lockedTo, bottom.id);
    assert.equal(leg.autoPlaced, true);
  });
});

test("закреплённая группа ножек поворачивается на плоскости вместе с дном", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart({ lengthMm: 600, widthMm: 400 });
  model.updatePart(bottom.id, { partType: "bottom" });
  const legs = model.placeBottomLegs(bottom.id, 40);

  model.updatePart(bottom.id, { rotationY: 90 });
  assert.deepEqual(
    legs.map((leg) => [leg.xMm, leg.zMm]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    [[-131.5, -231.5], [-131.5, 231.5], [131.5, -231.5], [131.5, 231.5]],
  );
  legs.forEach((leg) => assert.equal(leg.rotationY, 90));
});

test("удаление дна удаляет закреплённую на нём группу ножек", () => {
  const model = new FurnitureModel();
  const bottom = model.addCustomPart();
  model.updatePart(bottom.id, { partType: "bottom" });
  model.placeBottomLegs(bottom.id, 40);

  model.deleteParts([bottom.id]);
  assert.equal(model.parts.length, 0);
});

test("ножка не может войти внутрь детали", () => {
  const model = new FurnitureModel();
  const panel = model.addCustomPart({ lengthMm: 600, widthMm: 400 });
  model.updatePart(panel.id, { yMm: 50 });
  const leg = model.addLeg();
  const before = { xMm: leg.xMm, yMm: leg.yMm, zMm: leg.zMm };

  const result = model.movePartConstrained(leg.id, { xMm: 0, yMm: 0, zMm: 0 });
  assert.equal(result, false);
  assert.deepEqual(
    { xMm: leg.xMm, yMm: leg.yMm, zMm: leg.zMm },
    before,
  );
});

test("размеры и координаты округляются до 1 мм", () => {
  const model = new FurnitureModel();
  const part = model.addPart("side");
  model.updatePart(part.id, { sizeX: 18.7, xMm: 12.6, yMm: 40.4, zMm: -8.7 });
  assert.equal(part.sizeX, 19);
  assert.equal(part.xMm, 13);
  assert.equal(part.yMm, 40);
  assert.equal(part.zMm, -9);
});

test("история восстанавливает добавление и изменение детали", () => {
  const model = new FurnitureModel();
  const history = new History(model);
  const part = history.commit("Добавить", () => model.addPart("facade"));
  history.commit("Изменить", () => model.updatePart(part.id, { sizeX: 555 }));
  assert.equal(model.getPart(part.id).sizeX, 555);
  history.undo();
  assert.equal(model.getPart(part.id).sizeX, 600);
  history.undo();
  assert.equal(model.parts.length, 0);
  history.redo();
  assert.equal(model.parts.length, 1);
});

test("состояние модели полностью восстанавливается после перезагрузки", () => {
  const model = new FurnitureModel();
  const part = model.addCustomPart({ material: "ldsp-16", lengthMm: 812, widthMm: 367 });
  model.updatePart(part.id, { xMm: 125, yMm: 420, zMm: -38, rotationZ: 90 });
  const saved = model.toJSON();

  const restored = new FurnitureModel();
  restored.restore(saved);
  assert.deepEqual(restored.toJSON(), saved);
});

test("старые сохранённые ножки получают новые точные габариты", () => {
  const model = new FurnitureModel();
  const leg = model.addLeg();
  const saved = model.toJSON();
  saved.parts[0] = { ...leg, sizeX: 30, sizeY: 100, sizeZ: 30 };

  const restored = new FurnitureModel();
  restored.restore(saved);
  assert.deepEqual(
    { x: restored.parts[0].sizeX, y: restored.parts[0].sizeY, z: restored.parts[0].sizeZ },
    { x: 57, y: 100, z: 57 },
  );
});

test("после загрузки повреждённая связка восстанавливается без пересечения ножки и детали", () => {
  const model = new FurnitureModel();
  const panel = model.addCustomPart({ lengthMm: 600, widthMm: 400 });
  const leg = model.addLeg();
  const saved = model.toJSON();
  saved.parts.find((part) => part.id === panel.id).yMm = 45;
  Object.assign(saved.parts.find((part) => part.id === leg.id), {
    yMm: 0,
    attachedTo: panel.id,
  });

  const restored = new FurnitureModel();
  restored.restore(saved);
  const restoredPanel = restored.getPart(panel.id);
  const restoredLeg = restored.getPart(leg.id);
  assert.equal(restoredPanel.yMm, 100);
  assert.equal(restoredLeg.yMm, 0);
});
