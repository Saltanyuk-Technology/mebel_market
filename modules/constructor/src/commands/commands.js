class SnapshotCommand {
  constructor(room, label) {
    this.room = room;
    this.label = label;
    this.before = room.toJSON();
    this.after = null;
  }

  mutate() {}

  execute() {
    if (this.after) {
      this.room.restore(this.after);
      return true;
    }
    const result = this.mutate();
    this.after = this.room.toJSON();
    return result !== false;
  }

  undo() { this.room.restore(this.before); }
  redo() { this.room.restore(this.after); }
}

export class StateChangeCommand {
  constructor(room, label, before, after) {
    this.room = room;
    this.label = label;
    this.before = before;
    this.after = after;
  }
  execute() { this.room.restore(this.after); }
  undo() { this.room.restore(this.before); }
  redo() { this.room.restore(this.after); }
}

export class AddWallCommand extends SnapshotCommand {
  constructor(room, start, end, { startPointId = null, endPointId = null, close = false, heightMm = null, thicknessMm = null } = {}) {
    super(room, "Добавить стену");
    this.start = start;
    this.end = end;
    this.startPointId = startPointId;
    this.endPointId = endPointId;
    this.close = close;
    this.heightMm = heightMm;
    this.thicknessMm = thicknessMm;
    this.createdWallId = null;
  }

  mutate() {
    const createdStart = !this.startPointId;
    const createdEnd = !this.endPointId;
    const startPoint = createdStart ? this.room.addPoint(this.start.xMm, this.start.zMm) : this.room.getPoint(this.startPointId);
    const endPoint = createdEnd ? this.room.addPoint(this.end.xMm, this.end.zMm) : this.room.getPoint(this.endPointId);
    const wall = this.room.addWall(startPoint.id, endPoint.id, null, {
      heightMm: this.heightMm ?? this.room.wallHeightMm,
      thicknessMm: this.thicknessMm ?? this.room.gridStepMm * 2,
    });
    if (!wall) {
      const orphanIds = new Set([
        ...(createdStart ? [startPoint.id] : []),
        ...(createdEnd ? [endPoint.id] : []),
      ]);
      this.room.points = this.room.points.filter((point) => !orphanIds.has(point.id));
      return false;
    }
    this.createdWallId = wall.id;
    if (this.close) this.room.isClosed = true;
    return true;
  }
}

export class AddStandaloneWallCommand extends AddWallCommand {
  constructor(room, center, { lengthMm = 3000, heightMm = 2700, thicknessMm = null } = {}) {
    super(
      room,
      { xMm: center.xMm - lengthMm / 2, zMm: center.zMm },
      { xMm: center.xMm + lengthMm / 2, zMm: center.zMm },
      { heightMm, thicknessMm: thicknessMm ?? room.gridStepMm * 2 },
    );
    this.label = "Добавить стену";
  }
}

export class MovePointCommand extends SnapshotCommand {
  constructor(room, pointId, from, to) {
    super(room, "Переместить точку");
    this.pointId = pointId;
    this.from = from;
    this.to = to;
    this.before = room.toJSON();
    room.movePoint(pointId, from.xMm, from.zMm);
    this.before = room.toJSON();
    room.movePoint(pointId, to.xMm, to.zMm);
    this.after = room.toJSON();
  }
}

export class MoveWallCommand extends SnapshotCommand {
  constructor(room, wallId, from, to) {
    super(room, "Переместить или повернуть стену");
    this.wallId = wallId;
    this.before = room.toJSON();
    room.setWallPoints(wallId, from.start, from.end);
    this.before = room.toJSON();
    room.setWallPoints(wallId, to.start, to.end);
    this.after = room.toJSON();
  }
}

export class DeleteWallCommand extends SnapshotCommand {
  constructor(room, wallId) {
    super(room, "Удалить стену");
    this.wallId = wallId;
  }

  mutate() { this.room.deleteWall(this.wallId); }
}

export class ChangeRoomSettingsCommand extends SnapshotCommand {
  constructor(room, changes) {
    super(room, "Изменить параметры помещения");
    this.changes = changes;
  }

  mutate() { Object.assign(this.room, this.changes); }
}

export class ChangeWallLengthCommand extends SnapshotCommand {
  constructor(room, wallId, lengthMm) {
    super(room, "Изменить длину стены");
    this.wallId = wallId;
    this.lengthMm = lengthMm;
  }

  mutate() { this.room.setWallLength(this.wallId, this.lengthMm); }
}

export class ChangeWallPropertiesCommand extends SnapshotCommand {
  constructor(room, wallId, changes) {
    super(room, "Изменить стену");
    this.wallId = wallId;
    this.changes = changes;
  }

  mutate() { return this.room.setWallProperties(this.wallId, this.changes); }
}

export class AddWindowCommand extends SnapshotCommand {
  constructor(room, wallId) {
    super(room, "Добавить окно");
    this.wallId = wallId;
    this.createdWindowId = null;
  }
  mutate() {
    this.createdWindowId = this.room.addWindow(this.wallId)?.id ?? null;
    return Boolean(this.createdWindowId);
  }
}

export class AddDoorCommand extends SnapshotCommand {
  constructor(room, wallId) {
    super(room, "Добавить дверной проём");
    this.wallId = wallId;
    this.createdDoorId = null;
  }
  mutate() {
    this.createdDoorId = this.room.addWindow(this.wallId, { kind: "door" })?.id ?? null;
    return Boolean(this.createdDoorId);
  }
}

export class ChangeWindowPropertiesCommand extends SnapshotCommand {
  constructor(room, windowId, changes) {
    super(room, room.getWindow(windowId)?.kind === "door" ? "Изменить дверной проём" : "Изменить окно");
    this.windowId = windowId;
    this.changes = changes;
  }
  mutate() { this.room.setWindowProperties(this.windowId, this.changes); }
}

export class DeleteWindowCommand extends SnapshotCommand {
  constructor(room, windowId) {
    super(room, room.getWindow(windowId)?.kind === "door" ? "Удалить дверной проём" : "Удалить окно");
    this.windowId = windowId;
  }
  mutate() { this.room.deleteWindow(this.windowId); }
}

export class GroupItemsCommand extends SnapshotCommand {
  constructor(room, wallIds, windowIds) {
    super(room, "Сгруппировать детали");
    this.wallIds = wallIds;
    this.windowIds = windowIds;
  }
  mutate() { return this.room.groupItems(this.wallIds, this.windowIds); }
}

export class SetItemsLockedCommand extends SnapshotCommand {
  constructor(room, wallIds, windowIds, locked) {
    super(room, locked ? "Закрепить детали" : "Открепить детали");
    this.wallIds = wallIds;
    this.windowIds = windowIds;
    this.locked = locked;
  }
  mutate() { return this.room.setItemsLocked(this.wallIds, this.windowIds, this.locked); }
}
