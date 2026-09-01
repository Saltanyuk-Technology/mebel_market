import test from "node:test";
import assert from "node:assert/strict";
import { RoomModel } from "../src/model/RoomModel.js";
import { CommandManager } from "../src/core/CommandManager.js";
import { AddDoorCommand, AddStandaloneWallCommand, AddWallCommand, AddWindowCommand, ChangeRoomSettingsCommand, ChangeWallPropertiesCommand, ChangeWindowPropertiesCommand, DeleteWallCommand, MovePointCommand, MoveWallCommand } from "../src/commands/commands.js";
import { findFreeWallCenter, findWallCornerSnap, getCameraFacingWallSurface, getWallDimensionSpan, isWallPositiveFaceVisible, polygonSelfIntersects, segmentsIntersect, wallFootprint, wallsOverlap } from "../src/geometry/polygon.js";

function addSegment(room, commands, start, end, options = {}) {
  const command = new AddWallCommand(room, start, end, options);
  commands.execute(command);
  return room.walls.at(-1);
}

function createRectangle() {
  const room = new RoomModel();
  const commands = new CommandManager();
  let wall = addSegment(room, commands, { xMm: 0, zMm: 0 }, { xMm: 4000, zMm: 0 });
  wall = addSegment(room, commands, { xMm: 4000, zMm: 0 }, { xMm: 4000, zMm: 3000 }, { startPointId: wall.endPointId });
  wall = addSegment(room, commands, { xMm: 4000, zMm: 3000 }, { xMm: 0, zMm: 3000 }, { startPointId: wall.endPointId });
  addSegment(room, commands, { xMm: 0, zMm: 3000 }, { xMm: 0, zMm: 0 }, {
    startPointId: wall.endPointId,
    endPointId: room.walls[0].startPointId,
    close: true,
  });
  return { room, commands };
}

test("прямоугольник 3000×4000 мм замыкается с точными длинами", () => {
  const { room } = createRectangle();
  assert.equal(room.isClosed, true);
  assert.equal(room.walls.length, 4);
  assert.deepEqual(room.walls.map((wall) => Math.round(room.getWallLength(wall))), [4000, 3000, 4000, 3000]);
  assert.equal(polygonSelfIntersects(room.getOrderedContourPoints()), false);
});

test("Г-образный и диагональный контуры сохраняют миллиметровую геометрию", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  let wall = addSegment(room, commands, { xMm: 0, zMm: 0 }, { xMm: 4000, zMm: 0 });
  wall = addSegment(room, commands, { xMm: 4000, zMm: 0 }, { xMm: 4000, zMm: 2000 }, { startPointId: wall.endPointId });
  wall = addSegment(room, commands, { xMm: 4000, zMm: 2000 }, { xMm: 2000, zMm: 2000 }, { startPointId: wall.endPointId });
  wall = addSegment(room, commands, { xMm: 2000, zMm: 2000 }, { xMm: 2000, zMm: 4000 }, { startPointId: wall.endPointId });
  assert.equal(room.walls.length, 4);
  assert.equal(room.getWallLength(room.walls.at(-1)), 2000);

  const diagonal = addSegment(room, commands, { xMm: 2000, zMm: 4000 }, { xMm: 3000, zMm: 5000 }, { startPointId: wall.endPointId });
  assert.equal(Math.round(room.getWallLength(diagonal)), 1414);
});

test("самопересечение определяется", () => {
  const points = [
    { xMm: 0, zMm: 0 },
    { xMm: 3000, zMm: 3000 },
    { xMm: 0, zMm: 3000 },
    { xMm: 3000, zMm: 0 },
  ];
  assert.equal(polygonSelfIntersects(points), true);
  assert.equal(segmentsIntersect(points[0], points[1], points[2], points[3]), true);
});

test("перемещение, параметры, удаление, undo и redo восстанавливают модель", () => {
  const { room, commands } = createRectangle();
  const point = room.points[1];
  const from = { xMm: point.xMm, zMm: point.zMm };
  const to = { xMm: 4500, zMm: 0 };
  room.movePoint(point.id, to.xMm, to.zMm);
  commands.pushExecuted(new MovePointCommand(room, point.id, from, to));
  assert.equal(room.getPoint(point.id).xMm, 4500);
  commands.undo();
  assert.equal(room.getPoint(point.id).xMm, 4000);
  commands.redo();
  assert.equal(room.getPoint(point.id).xMm, 4500);

  commands.execute(new ChangeRoomSettingsCommand(room, { wallHeightMm: 3100, wallThicknessMm: 160 }));
  assert.equal(room.wallHeightMm, 3100);
  assert.equal(room.wallThicknessMm, 160);

  const wallId = room.walls[0].id;
  commands.execute(new DeleteWallCommand(room, wallId));
  assert.equal(room.isClosed, false);
  assert.equal(room.walls.length, 3);
  commands.undo();
  assert.equal(room.walls.length, 4);
});

test("новая отдельная стена создаётся размером 3000 на 2700 мм", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const command = new AddStandaloneWallCommand(room, { xMm: 1000, zMm: 500 });
  commands.execute(command);
  const wall = room.getWall(command.createdWallId);
  assert.equal(room.getWallLength(wall), 3000);
  assert.equal(room.getWallHeight(wall), 2700);
  assert.equal(room.getWallThickness(wall), room.gridStepMm * 2);
  assert.equal(room.getWallAngleDeg(wall), 0);
});

test("толщина новой стены равна двум клеткам сетки", () => {
  const room = new RoomModel();
  room.gridStepMm = 250;
  const commands = new CommandManager();
  const command = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(command);
  assert.equal(room.getWallThickness(command.createdWallId), 500);
});

test("окно создаётся только на стене и остаётся в её границах", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const missing = new AddWindowCommand(room, "wall-missing");
  commands.execute(missing);
  assert.equal(room.windows.length, 0);
  const wallCommand = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(wallCommand);
  const windowCommand = new AddWindowCommand(room, wallCommand.createdWallId);
  commands.execute(windowCommand);
  const item = room.getWindow(windowCommand.createdWindowId);
  assert.equal(item.widthMm, 1200);
  assert.equal(item.heightMm, 1400);
  commands.execute(new ChangeWindowPropertiesCommand(room, item.id, { widthMm: 2000, offsetMm: 99999 }));
  assert.ok(item.offsetMm <= room.getWallLength(item.wallId) - item.widthMm / 2);
  commands.execute(new DeleteWallCommand(room, item.wallId));
  assert.equal(room.windows.length, 0);
});

test("дверной проём создаётся от пола и редактируется как окно", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const wallCommand = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(wallCommand);
  const doorCommand = new AddDoorCommand(room, wallCommand.createdWallId);
  assert.equal(commands.execute(doorCommand), true);
  const doorway = room.getWindow(doorCommand.createdDoorId);

  assert.equal(doorway.kind, "door");
  assert.equal(doorway.widthMm, 900);
  assert.equal(doorway.heightMm, 2100);
  assert.equal(doorway.sillHeightMm, 0);

  commands.execute(new ChangeWindowPropertiesCommand(room, doorway.id, {
    widthMm: 1000,
    heightMm: 2200,
    sillHeightMm: 500,
  }));
  assert.equal(room.getWindow(doorway.id).widthMm, 1000);
  assert.equal(room.getWindow(doorway.id).heightMm, 2200);
  assert.equal(room.getWindow(doorway.id).sillHeightMm, 0);
  commands.undo();
  assert.equal(room.getWindow(doorway.id).widthMm, 900);
});

test("окна на одной стене не накладываются друг на друга", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const wallCommand = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(wallCommand);
  const firstCommand = new AddWindowCommand(room, wallCommand.createdWallId);
  commands.execute(firstCommand);
  const secondCommand = new AddWindowCommand(room, wallCommand.createdWallId);
  commands.execute(secondCommand);
  const first = room.getWindow(firstCommand.createdWindowId);
  const second = room.getWindow(secondCommand.createdWindowId);
  assert.ok(first && second);
  assert.ok(Math.abs(first.offsetMm - second.offsetMm) >= (first.widthMm + second.widthMm) / 2 + 100);

  room.setWindowProperties(second.id, { offsetMm: first.offsetMm });
  assert.ok(Math.abs(first.offsetMm - second.offsetMm) >= (first.widthMm + second.widthMm) / 2 + 100);

  const thirdCommand = new AddWindowCommand(room, wallCommand.createdWallId);
  commands.execute(thirdCommand);
  assert.equal(thirdCommand.createdWindowId, null);
  assert.equal(room.windows.length, 2);
});

test("окно переносится на другую стену и перенос отменяется", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const firstWall = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(firstWall);
  const secondWall = new AddStandaloneWallCommand(room, { xMm: 5000, zMm: 3000 }, { lengthMm: 4200 });
  commands.execute(secondWall);
  const addWindow = new AddWindowCommand(room, firstWall.createdWallId);
  commands.execute(addWindow);
  const item = room.getWindow(addWindow.createdWindowId);

  commands.execute(new ChangeWindowPropertiesCommand(room, item.id, {
    wallId: secondWall.createdWallId,
    offsetMm: 2100,
    sillHeightMm: 600,
  }));
  assert.equal(item.wallId, secondWall.createdWallId);
  assert.equal(item.offsetMm, 2100);
  assert.equal(item.sillHeightMm, 600);

  commands.undo();
  assert.equal(room.getWindow(item.id).wallId, firstWall.createdWallId);
});

test("размеры и поворот выбранной стены изменяются и отменяются", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const add = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(add);
  commands.execute(new ChangeWallPropertiesCommand(room, add.createdWallId, { lengthMm: 4200, heightMm: 3100, thicknessMm: 240, angleDeg: 90 }));
  const wall = room.getWall(add.createdWallId);
  assert.equal(room.getWallLength(wall), 4200);
  assert.equal(room.getWallHeight(wall), 3100);
  assert.equal(room.getWallThickness(wall), 240);
  assert.equal(room.getWallAngleDeg(wall), 90);
  commands.undo();
  assert.equal(room.getWallLength(wall.id), 3000);
  assert.equal(room.getWallHeight(wall.id), 2700);
  assert.equal(room.getWallThickness(wall.id), 200);
});

test("перемещение всей стены сохраняет длину и поддерживает undo", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const add = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(add);
  const wall = room.getWall(add.createdWallId);
  const points = room.getWallPoints(wall);
  const from = {
    start: { xMm: points.start.xMm, zMm: points.start.zMm },
    end: { xMm: points.end.xMm, zMm: points.end.zMm },
  };
  room.moveWall(wall.id, 500, 700);
  const moved = room.getWallPoints(wall.id);
  const to = {
    start: { xMm: moved.start.xMm, zMm: moved.start.zMm },
    end: { xMm: moved.end.xMm, zMm: moved.end.zMm },
  };
  commands.pushExecuted(new MoveWallCommand(room, wall.id, from, to));
  assert.equal(room.getWallLength(wall.id), 3000);
  assert.equal(room.getWallPoints(wall.id).start.xMm, -1000);
  commands.undo();
  assert.equal(room.getWallPoints(wall.id).start.xMm, -1500);
});

test("move command applies both wall corners atomically near an obstacle", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const moving = addSegment(room, commands, { xMm: -1500, zMm: 0 }, { xMm: 1500, zMm: 0 });
  addSegment(room, commands, { xMm: 0, zMm: 300 }, { xMm: 0, zMm: 700 });
  const from = {
    start: { xMm: -1500, zMm: 0 },
    end: { xMm: 1500, zMm: 0 },
  };
  const to = {
    start: { xMm: -1500, zMm: 1000 },
    end: { xMm: 1500, zMm: 1000 },
  };
  assert.equal(room.setWallPoints(moving.id, to.start, to.end), true);

  commands.pushExecuted(new MoveWallCommand(room, moving.id, from, to));
  assert.equal(room.getWallPoints(moving).start.zMm, 1000);
  assert.equal(room.getWallPoints(moving).end.zMm, 1000);
  assert.equal(room.getWallLength(moving), 3000);
  assert.equal(room.getWallAngleDeg(moving), 0);

  commands.undo();
  assert.equal(room.getWallPoints(moving).start.zMm, 0);
  assert.equal(room.getWallAngleDeg(moving), 0);
  commands.redo();
  assert.equal(room.getWallPoints(moving).start.zMm, 1000);
  assert.equal(room.getWallAngleDeg(moving), 0);
});

test("walls cannot overlap when moved, rotated, resized, or thickened", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const first = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  const second = new AddStandaloneWallCommand(room, { xMm: 0, zMm: -1000 });
  commands.execute(first);
  commands.execute(second);

  assert.equal(room.moveWall(second.createdWallId, 0, 900), false);
  assert.equal(wallsOverlap(room, first.createdWallId, second.createdWallId), false);
  assert.equal(room.getWallPoints(second.createdWallId).start.zMm, -1000);

  assert.equal(room.setWallAngle(second.createdWallId, 90), false);
  assert.equal(room.getWallAngleDeg(second.createdWallId), 0);

  assert.equal(room.setWallProperties(second.createdWallId, { thicknessMm: 1200 }), false);
  assert.equal(room.getWallThickness(second.createdWallId), 200);
});

test("touching wall faces are allowed but adding an overlapping wall is rejected", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const first = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  const touching = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 200 });
  const overlapping = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 100 });
  assert.equal(commands.execute(first), true);
  assert.equal(commands.execute(touching), true);
  assert.equal(commands.execute(overlapping), false);
  assert.equal(overlapping.createdWallId, null);
  assert.equal(room.walls.length, 2);
});

test("wall dimension measures the visible span between adjoining wall edges", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const target = addSegment(room, commands, { xMm: 0, zMm: 0 }, { xMm: 3000, zMm: 0 });
  addSegment(room, commands, { xMm: 0, zMm: 1000 }, { xMm: 0, zMm: 0 }, {
    endPointId: target.startPointId,
  });

  const span = getWallDimensionSpan(room, target);
  assert.equal(Math.round(span.startInsetMm), 200);
  assert.equal(Math.round(span.endInsetMm), 0);
  assert.equal(Math.round(span.lengthMm), 2800);
  assert.equal(Math.round(room.getWallVisibleLength(target)), 2800);

  const frontFaceSpan = getWallDimensionSpan(room, target, 200);
  const backFaceSpan = getWallDimensionSpan(room, target, 0);
  assert.equal(Math.round(frontFaceSpan.lengthMm), 2800);
  assert.equal(Math.round(backFaceSpan.lengthMm), 2800);
  assert.equal(Math.round(frontFaceSpan.start.zMm), 200);
  assert.equal(Math.round(backFaceSpan.start.zMm), 0);

  assert.equal(room.setWallVisibleLength(target.id, 3000), true);
  assert.equal(Math.round(room.getWallLength(target)), 3200);
  assert.equal(Math.round(room.getWallVisibleLength(target)), 3000);
});

test("wall dimensions use the face nearest to the camera", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const wallCommand = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(wallCommand);

  const front = getCameraFacingWallSurface(room, wallCommand.createdWallId, { xMm: 0, zMm: 5000 });
  assert.equal(front.faceOffsetMm, 200);
  assert.equal(front.overlayOffsetMm, 3);

  const back = getCameraFacingWallSurface(room, wallCommand.createdWallId, { xMm: 0, zMm: -5000 });
  assert.equal(back.faceOffsetMm, 0);
  assert.equal(back.overlayOffsetMm, -3);
});

test("window dimensions are visible only from the window side of a wall", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const wallCommand = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(wallCommand);

  assert.equal(
    isWallPositiveFaceVisible(room, wallCommand.createdWallId, { xMm: 0, zMm: 5000 }),
    true,
  );
  assert.equal(
    isWallPositiveFaceVisible(room, wallCommand.createdWallId, { xMm: 0, zMm: -5000 }),
    false,
  );
});

test("dragged wall stops flush against another wall instead of leaving a grid gap", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const moving = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  const blocker = new AddStandaloneWallCommand(room, { xMm: 2000, zMm: 1000 });
  commands.execute(moving);
  commands.execute(blocker);
  assert.equal(room.setWallAngle(blocker.createdWallId, 90), true);

  assert.equal(room.moveWall(moving.createdWallId, 350, 0), false);
  assert.equal(room.moveWallClamped(moving.createdWallId, 350, 0), true);

  const movedPoints = room.getWallPoints(moving.createdWallId);
  assert.equal(movedPoints.end.xMm, 1800);
  assert.equal(wallsOverlap(room, moving.createdWallId, blocker.createdWallId), false);
  assert.equal(Math.round(room.getWallVisibleLength(moving.createdWallId)), 2800);
});

test("moving a connected wall preserves an exact right angle at the joint", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const first = addSegment(room, commands, { xMm: 0, zMm: 0 }, { xMm: 3000, zMm: 0 });
  const second = addSegment(
    room,
    commands,
    { xMm: 3000, zMm: 0 },
    { xMm: 3000, zMm: 3000 },
    { startPointId: first.endPointId },
  );

  assert.equal(room.moveWallGroupClamped(first.id, 120, 300), true);
  assert.equal(room.getWallAngleDeg(first), 0);
  assert.equal(room.getWallAngleDeg(second), 90);
  assert.equal(room.getWallPoints(first).start.xMm, 0);
  assert.equal(room.getWallPoints(first).start.zMm, 300);
});

test("moving a connected wall does not rotate a diagonal neighbour", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const first = addSegment(room, commands, { xMm: 0, zMm: 0 }, { xMm: 3000, zMm: 0 });
  const second = addSegment(
    room,
    commands,
    { xMm: 3000, zMm: 0 },
    { xMm: 4000, zMm: 1000 },
    { startPointId: first.endPointId },
  );

  assert.equal(room.moveWallGroupClamped(first.id, 300, 0), true);
  assert.equal(room.getWallAngleDeg(first), 0);
  assert.equal(room.getWallAngleDeg(second), 45);
});

test("a dragged wall corner snaps exactly to an off-grid wall corner", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const target = new AddStandaloneWallCommand(room, { xMm: 37, zMm: 83 });
  const moving = new AddStandaloneWallCommand(room, { xMm: 4000, zMm: 1000 });
  commands.execute(target);
  commands.execute(moving);

  const snapped = findWallCornerSnap(room, [moving.createdWallId], -900, -900);
  assert.ok(snapped);
  assert.equal(room.moveWallGroupClamped(moving.createdWallId, snapped.dxMm, snapped.dzMm), true);

  const targetCorners = wallFootprint(room, room.getWall(target.createdWallId));
  const movingCorners = wallFootprint(room, room.getWall(moving.createdWallId));
  assert.deepEqual(movingCorners[0], targetCorners[1]);
  assert.equal(wallsOverlap(room, moving.createdWallId, target.createdWallId), false);
});

test("new wall placement finds nearby empty space when the view center is occupied", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const first = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  commands.execute(first);

  const freeCenter = findFreeWallCenter(room, { xMm: 0, zMm: 0 });
  assert.ok(freeCenter);
  assert.notDeepEqual(freeCenter, { xMm: 0, zMm: 0 });

  const second = new AddStandaloneWallCommand(room, freeCenter);
  assert.equal(commands.execute(second), true);
  assert.equal(wallsOverlap(room, first.createdWallId, second.createdWallId), false);
});

test("grouped walls move together and locked walls remain fixed", () => {
  const room = new RoomModel();
  const commands = new CommandManager();
  const first = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 0 });
  const second = new AddStandaloneWallCommand(room, { xMm: 0, zMm: 1000 });
  commands.execute(first);
  commands.execute(second);
  assert.equal(room.groupItems([first.createdWallId, second.createdWallId], []), true);

  const firstBefore = room.getWallPoints(first.createdWallId).start.xMm;
  const secondBefore = room.getWallPoints(second.createdWallId).start.xMm;
  assert.equal(room.moveWallGroupClamped(first.createdWallId, 500, 300), true);
  assert.equal(room.getWallPoints(first.createdWallId).start.xMm, firstBefore + 500);
  assert.equal(room.getWallPoints(second.createdWallId).start.xMm, secondBefore + 500);

  room.setItemsLocked([first.createdWallId, second.createdWallId], [], true);
  const lockedPosition = room.getWallPoints(first.createdWallId).start.xMm;
  assert.equal(room.moveWallGroupClamped(first.createdWallId, 500, 0), false);
  assert.equal(room.getWallPoints(first.createdWallId).start.xMm, lockedPosition);
});
