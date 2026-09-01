import { distanceMm } from "../core/units.js";
import { AddWallCommand, ChangeWallPropertiesCommand, ChangeWindowPropertiesCommand, DeleteWallCommand, DeleteWindowCommand, GroupItemsCommand, MovePointCommand, MoveWallCommand, SetItemsLockedCommand, StateChangeCommand } from "../commands/commands.js";
import { findWallCornerSnap, polygonSelfIntersects, wouldIntersectExisting } from "../geometry/polygon.js";

export class EditorController {
  constructor({ room, scene, commands, snap, onChange, onCursor, onToolChange, onToast }) {
    this.room = room;
    this.scene = scene;
    this.commands = commands;
    this.snap = snap;
    this.onChange = onChange;
    this.onCursor = onCursor;
    this.onToolChange = onToolChange;
    this.onToast = onToast;
    this.tool = "select";
    this.selectedWallId = null;
    this.selectedWindowId = null;
    this.selectedWallIds = new Set();
    this.selectedWindowIds = new Set();
    this.anchor = null;
    this.previewSnap = null;
    this.drag = null;
    this.lastWallPress = null;
    this.lastWindowPress = null;
    this.backgroundPress = null;
    this.bindEvents();
  }

  bindEvents() {
    const canvas = this.scene.canvas;
    canvas.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    canvas.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    canvas.addEventListener("dblclick", (event) => this.handleDoubleClick(event));
    canvas.addEventListener("wheel", (event) => this.handleWheel(event), { passive: false, capture: true });
    window.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  setTool(tool) {
    this.tool = tool;
    this.anchor = null;
    this.scene.setPreview(null, null);
    this.scene.setControlsEnabled(tool !== "draw");
    if (tool === "draw") this.selectWall(null);
    this.onToolChange?.(tool);
  }

  setSelectedWall(wallId) {
    this.selectWall(wallId);
  }

  selectionCount() {
    return this.selectedWallIds.size + this.selectedWindowIds.size;
  }

  syncSelection() {
    const total = this.selectionCount();
    this.selectedWallId = total === 1 && this.selectedWallIds.size === 1
      ? this.selectedWallIds.values().next().value
      : null;
    this.selectedWindowId = total === 1 && this.selectedWindowIds.size === 1
      ? this.selectedWindowIds.values().next().value
      : null;
    if (total !== 1) {
      this.scene.resizeWallId = null;
      this.scene.resizeWindowId = null;
    }
    this.scene.selectedWallIds = new Set(this.selectedWallIds);
    this.scene.selectedWindowIds = new Set(this.selectedWindowIds);
    this.scene.selectedWindowId = this.selectedWindowId;
    this.scene.syncRoom(this.room, this.selectedWallId, this.selectedWindowId);
    this.onChange?.();
  }

  selectWall(wallId, additive = false) {
    if (!additive) {
      this.selectedWallIds.clear();
      this.selectedWindowIds.clear();
    }
    if (wallId) {
      const wall = this.room.getWall(wallId);
      const members = wall?.groupId ? this.room.getGroupMembers(wall.groupId) : { walls: [wall], windows: [] };
      const alreadySelected = members.walls.every((item) => this.selectedWallIds.has(item.id))
        && members.windows.every((item) => this.selectedWindowIds.has(item.id));
      members.walls.forEach((item) => {
        if (additive && alreadySelected) this.selectedWallIds.delete(item.id);
        else this.selectedWallIds.add(item.id);
      });
      members.windows.forEach((item) => {
        if (additive && alreadySelected) this.selectedWindowIds.delete(item.id);
        else this.selectedWindowIds.add(item.id);
      });
    }
    this.scene.resizeWindowId = null;
    this.syncSelection();
  }

  selectWindow(windowId, additive = false) {
    if (!additive) {
      this.selectedWallIds.clear();
      this.selectedWindowIds.clear();
    }
    if (windowId) {
      const item = this.room.getWindow(windowId);
      const members = item?.groupId ? this.room.getGroupMembers(item.groupId) : { walls: [], windows: [item] };
      const alreadySelected = members.walls.every((wall) => this.selectedWallIds.has(wall.id))
        && members.windows.every((windowItem) => this.selectedWindowIds.has(windowItem.id));
      members.walls.forEach((wall) => {
        if (additive && alreadySelected) this.selectedWallIds.delete(wall.id);
        else this.selectedWallIds.add(wall.id);
      });
      members.windows.forEach((windowItem) => {
        if (additive && alreadySelected) this.selectedWindowIds.delete(windowItem.id);
        else this.selectedWindowIds.add(windowItem.id);
      });
    }
    this.scene.resizeWallId = null;
    this.syncSelection();
  }

  resetTransientState() {
    this.anchor = null;
    this.drag = null;
    this.selectWall(null);
    this.scene.setPreview(null, null);
  }

  handlePointerMove(event) {
    if (this.drag?.type === "window-resize-height") {
      const item = this.room.getWindow(this.drag.windowId);
      const value = this.drag.fromHeightMm + (this.drag.startClientY - event.clientY) * 10;
      this.room.setWindowProperties(item.id, { heightMm: Math.round(value / 50) * 50 });
      this.scene.syncRoom(this.room, null, item.id);
      this.onChange?.();
      return;
    }
    if (this.drag?.type === "window-resize-width") {
      const item = this.room.getWindow(this.drag.windowId);
      const pixelDelta = (event.clientX - this.drag.startClientX) * this.drag.screenAxis.x + (event.clientY - this.drag.startClientY) * this.drag.screenAxis.y;
      const deltaMm = Math.round((pixelDelta * this.drag.screenAxis.mmPerPixel) / 50) * 50;
      const signedDelta = this.drag.action === "width-start" ? -deltaMm : deltaMm;
      this.room.setWindowProperties(item.id, {
        widthMm: this.drag.fromWidthMm + signedDelta,
        offsetMm: this.drag.fromOffsetMm + deltaMm / 2,
      });
      this.scene.syncRoom(this.room, null, item.id);
      this.onChange?.();
      return;
    }
    if (this.drag?.type === "window") {
      const item = this.room.getWindow(this.drag.windowId);
      const placement = this.scene.getWindowWallPlacement(event, item, this.drag.pointerAnchor);
      if (!placement) return;
      const step = this.room.snapEnabled ? 50 : 10;
      this.room.setWindowProperties(this.drag.windowId, {
        wallId: placement.wallId,
        offsetMm: Math.round(placement.offsetMm / step) * step,
        sillHeightMm: Math.round(placement.sillHeightMm / step) * step,
      });
      this.scene.syncRoom(this.room, null, this.drag.windowId);
      this.onChange?.();
      return;
    }
    if (this.drag?.type === "resize-height") {
      const wall = this.room.getWall(this.drag.wallId);
      if (!wall) return;
      const rawHeight = this.drag.fromHeightMm + (this.drag.startClientY - event.clientY) * 10;
      const step = this.room.snapEnabled ? this.room.gridStepMm : 10;
      wall.heightMm = Math.max(300, Math.round(rawHeight / step) * step);
      this.scene.syncRoom(this.room, this.selectedWallId);
      this.onChange?.();
      return;
    }

    const raw = this.scene.getGroundPoint(event);
    if (!raw) return;

    if (this.drag) {
      if (this.drag.type === "resize-length") {
        const dx = raw.xMm - this.drag.fixed.xMm;
        const dz = raw.zMm - this.drag.fixed.zMm;
        const projectedLength = dx * this.drag.axis.x + dz * this.drag.axis.z;
        const step = this.room.snapEnabled ? this.room.gridStepMm : 10;
        const lengthMm = Math.max(step, Math.round(projectedLength / step) * step);
        const moved = this.room.movePoint(
          this.drag.pointId,
          this.drag.fixed.xMm + this.drag.axis.x * lengthMm,
          this.drag.fixed.zMm + this.drag.axis.z * lengthMm,
        );
        if (!moved) this.onToast?.("Стены не могут пересекаться");
        this.scene.syncRoom(this.room, this.selectedWallId);
        this.onChange?.();
        return;
      }
      if (this.drag.type === "wall") {
        const points = this.room.getWallPoints(this.drag.wallId);
        const center = {
          xMm: (points.start.xMm + points.end.xMm) / 2,
          zMm: (points.start.zMm + points.end.zMm) / 2,
        };
        const step = this.room.snapEnabled ? this.room.gridStepMm : 1;
        const rawDesiredX = raw.xMm - this.drag.grabOffset.xMm;
        const rawDesiredZ = raw.zMm - this.drag.grabOffset.zMm;
        const wall = this.room.getWall(this.drag.wallId);
        const movingWallIds = wall.groupId
          ? this.room.getGroupMembers(wall.groupId).walls.map((item) => item.id)
          : [wall.id];
        const cornerSnap = this.room.snapEnabled
          ? findWallCornerSnap(
            this.room,
            movingWallIds,
            rawDesiredX - center.xMm,
            rawDesiredZ - center.zMm,
          )
          : null;
        const moveX = cornerSnap?.dxMm
          ?? Math.round(rawDesiredX / step) * step - center.xMm;
        const moveZ = cornerSnap?.dzMm
          ?? Math.round(rawDesiredZ / step) * step - center.zMm;
        const moved = this.room.moveWallGroupClamped(this.drag.wallId, moveX, moveZ);
        if (moved) {
          const movedPoints = this.room.getWallPoints(this.drag.wallId);
          center.xMm = (movedPoints.start.xMm + movedPoints.end.xMm) / 2;
          center.zMm = (movedPoints.start.zMm + movedPoints.end.zMm) / 2;
        }
        this.scene.syncRoom(this.room, this.selectedWallId);
        this.onCursor?.(center, cornerSnap ? "Угол" : this.room.snapEnabled ? "Сетка" : null, null, event);
        return;
      }
      const snapped = this.snap.snap(raw, this.room, null, 140, this.drag.pointId);
      const moved = this.room.movePoint(this.drag.pointId, snapped.point.xMm, snapped.point.zMm);
      if (!moved) this.onToast?.("Стены не могут пересекаться");
      this.scene.syncRoom(this.room, this.selectedWallId);
      this.onCursor?.(snapped.point, snapped.kind, null, event);
      return;
    }

    const anchorPoint = this.anchor ? { xMm: this.anchor.xMm, zMm: this.anchor.zMm } : null;
    const snapped = this.snap.snap(raw, this.room, anchorPoint);
    this.previewSnap = snapped;
    const length = anchorPoint ? distanceMm(anchorPoint, snapped.point) : null;
    if (this.tool === "draw" && anchorPoint) this.scene.setPreview(anchorPoint, snapped.point, snapped.kind);
    this.onCursor?.(snapped.point, snapped.kind, length, event);
  }

  handlePointerDown(event) {
    if (event.button !== 0) return;
    this.backgroundPress = null;
    if (this.tool === "draw") {
      this.handleDrawClick(event);
      return;
    }

    const picked = this.scene.pick(event, true);
    if (picked?.type === "resize-handle") {
      if (picked.ownerType === "window") {
        const item = this.room.getWindow(picked.ownerId);
        if (!item) return;
        if (item.locked) {
          this.onToast?.("Деталь закреплена");
          return;
        }
        this.drag = picked.action === "height" ? {
          type: "window-resize-height", windowId: item.id, fromHeightMm: item.heightMm, startClientY: event.clientY,
        } : {
          type: "window-resize-width", windowId: item.id, action: picked.action,
          fromWidthMm: item.widthMm, fromOffsetMm: item.offsetMm,
          startClientX: event.clientX, startClientY: event.clientY,
          screenAxis: this.scene.getWindowScreenAxis(item),
        };
        this.scene.setControlsEnabled(false);
        this.scene.canvas.setPointerCapture?.(event.pointerId);
        return;
      }
      const wall = this.room.getWall(picked.ownerId);
      const points = this.room.getWallPoints(wall);
      if (!wall || !points) return;
      if (wall.locked) {
        this.onToast?.("Деталь закреплена");
        return;
      }
      if (picked.action === "height") {
        this.drag = {
          type: "resize-height",
          wallId: wall.id,
          fromHeightMm: this.room.getWallHeight(wall),
          startClientY: event.clientY,
        };
      } else {
        const moving = picked.action === "length-start" ? points.start : points.end;
        const fixed = picked.action === "length-start" ? points.end : points.start;
        const dx = moving.xMm - fixed.xMm;
        const dz = moving.zMm - fixed.zMm;
        const length = Math.hypot(dx, dz);
        this.drag = {
          type: "resize-length",
          wallId: wall.id,
          pointId: moving.id,
          from: { xMm: moving.xMm, zMm: moving.zMm },
          fixed: { xMm: fixed.xMm, zMm: fixed.zMm },
          axis: { x: dx / length, z: dz / length },
        };
      }
      this.scene.setControlsEnabled(false);
      this.scene.canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (picked?.type === "window") {
      const pressTime = event.timeStamp;
      const isDoublePress = this.lastWindowPress?.id === picked.id && pressTime - this.lastWindowPress.time < 450;
      this.lastWindowPress = { id: picked.id, time: pressTime };
      if (isDoublePress && this.scene.viewMode === "3d") {
        event.preventDefault();
        this.lastWindowPress = null;
        this.enterWindowResizeMode(picked.id);
        return;
      }
      const item = this.room.getWindow(picked.id);
      if (event.ctrlKey) {
        this.selectWindow(item.id, true);
        return;
      }
      if (item.locked) {
        this.selectWindow(item.id);
        this.onToast?.("Деталь закреплена");
        return;
      }
      const pointerAnchor = this.scene.getWindowPointerAnchor(event, item);
      this.selectWindow(item.id);
      this.drag = {
        type: "window", windowId: item.id,
        fromWallId: item.wallId, fromOffsetMm: item.offsetMm, fromSillHeightMm: item.sillHeightMm,
        pointerAnchor,
      };
      this.scene.setControlsEnabled(false);
      this.scene.canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (picked?.type === "point" && this.scene.viewMode === "top") {
      const point = this.room.getPoint(picked.id);
      const locked = this.room.walls.some((wall) => (
        wall.locked && (wall.startPointId === point.id || wall.endPointId === point.id)
      ));
      if (locked) {
        this.onToast?.("Деталь закреплена");
        return;
      }
      this.drag = {
        type: "point",
        pointId: picked.id,
        from: { xMm: point.xMm, zMm: point.zMm },
      };
      this.scene.setControlsEnabled(false);
      this.scene.canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    if (picked?.type === "wall") {
      this.lastWindowPress = null;
      const pressTime = event.timeStamp;
      const isDoublePress = this.lastWallPress?.id === picked.id && pressTime - this.lastWallPress.time < 450;
      this.lastWallPress = { id: picked.id, time: pressTime };
      if (isDoublePress && this.scene.viewMode === "3d") {
        event.preventDefault();
        this.lastWallPress = null;
        this.enterResizeMode(picked.id);
        return;
      }
      if (event.ctrlKey) {
        this.selectWall(picked.id, true);
        return;
      }
      this.selectWall(picked.id);
      const selectedWall = this.room.getWall(picked.id);
      const lockedGroup = selectedWall?.groupId
        ? this.room.getGroupMembers(selectedWall.groupId).walls.some((wall) => wall.locked)
        : selectedWall?.locked;
      if (lockedGroup) {
        this.onToast?.("Деталь закреплена");
        return;
      }
      const raw = this.scene.getGroundPoint(event);
      const points = this.room.getWallPoints(picked.id);
      if (raw && points) {
        const center = {
          xMm: (points.start.xMm + points.end.xMm) / 2,
          zMm: (points.start.zMm + points.end.zMm) / 2,
        };
        this.drag = {
          type: "wall",
          wallId: picked.id,
          pointer: raw,
          grabOffset: { xMm: raw.xMm - center.xMm, zMm: raw.zMm - center.zMm },
          start: { id: points.start.id, xMm: points.start.xMm, zMm: points.start.zMm },
          end: { id: points.end.id, xMm: points.end.xMm, zMm: points.end.zMm },
          beforeState: this.room.toJSON(),
        };
        this.scene.setControlsEnabled(false);
        this.scene.canvas.setPointerCapture?.(event.pointerId);
      }
      return;
    }
    this.lastWallPress = null;
    this.lastWindowPress = null;
    this.backgroundPress = { x: event.clientX, y: event.clientY };
  }

  handleDoubleClick(event) {
    if (this.tool !== "select" || this.scene.viewMode !== "3d") return;
    const pickedWindow = this.scene.pickWindow(event);
    if (pickedWindow) {
      event.preventDefault();
      this.enterWindowResizeMode(pickedWindow.id);
      return;
    }
    const picked = this.scene.pickWall(event);
    if (picked?.type !== "wall") return;
    event.preventDefault();
    this.enterResizeMode(picked.id);
  }

  enterWindowResizeMode(windowId) {
    this.selectedWallIds.clear();
    this.selectedWindowIds = new Set([windowId]);
    this.selectedWindowId = windowId;
    this.selectedWallId = null;
    this.scene.resizeWallId = null;
    this.scene.resizeWindowId = windowId;
    this.scene.selectedWindowId = windowId;
    this.scene.selectedWallIds = new Set();
    this.scene.selectedWindowIds = new Set([windowId]);
    this.scene.syncRoom(this.room, null, windowId);
    this.onChange?.();
  }

  enterResizeMode(wallId) {
    this.selectedWindowIds.clear();
    this.selectedWallIds = new Set([wallId]);
    this.selectedWallId = wallId;
    this.selectedWindowId = null;
    this.scene.selectedWindowId = null;
    this.scene.resizeWindowId = null;
    this.scene.resizeWallId = wallId;
    this.scene.selectedWallIds = new Set([wallId]);
    this.scene.selectedWindowIds = new Set();
    this.scene.syncRoom(this.room, wallId, null);
    this.onChange?.();
  }

  handleWheel(event) {
    if (this.drag?.type !== "wall" || event.deltaY === 0) return;
    if (this.room.getWall(this.drag.wallId)?.groupId || this.room.getWall(this.drag.wallId)?.locked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const angle = this.room.getWallAngleDeg(this.drag.wallId);
    const direction = event.deltaY < 0 ? 1 : -1;
    if (!this.room.setWallAngle(this.drag.wallId, angle + direction * 15)) {
      this.onToast?.("Стены не могут пересекаться");
    }
    this.scene.syncRoom(this.room, this.selectedWallId);
    this.onChange?.();
  }

  handleDrawClick(event) {
    const raw = this.scene.getGroundPoint(event);
    if (!raw) return;
    const anchorPoint = this.anchor ? { xMm: this.anchor.xMm, zMm: this.anchor.zMm } : null;
    const snapped = this.snap.snap(raw, this.room, anchorPoint);

    if (!this.anchor) {
      this.anchor = { ...snapped.point, pointId: snapped.targetPointId };
      this.onChange?.();
      return;
    }

    this.commitWall(snapped.point, snapped.targetPointId);
  }

  commitWall(endPoint, targetPointId = null) {
    const start = { xMm: this.anchor.xMm, zMm: this.anchor.zMm };
    if (distanceMm(start, endPoint) < 10) {
      this.onToast?.("Стена должна быть длиннее 10 мм");
      return false;
    }

    const firstPointId = this.room.getOrderedContourPoints()[0]?.id ?? null;
    const close = Boolean(targetPointId && targetPointId === firstPointId && this.room.walls.length >= 2);
    const startForValidation = { id: this.anchor.pointId ?? "draft-start", ...start };
    const endForValidation = { id: targetPointId ?? "draft-end", ...endPoint };
    if (wouldIntersectExisting(this.room, startForValidation, endForValidation, close)) {
      this.onToast?.("Стена пересекает существующий контур");
      return false;
    }

    const command = new AddWallCommand(this.room, start, endPoint, {
      startPointId: this.anchor.pointId,
      endPointId: targetPointId,
      close,
    });
    if (!this.commands.execute(command)) {
      this.onToast?.("Стены не могут пересекаться");
      return false;
    }
    const wall = this.room.walls.at(-1);

    if (close) {
      if (polygonSelfIntersects(this.room.getOrderedContourPoints())) {
        this.commands.undo();
        this.onToast?.("Контур самопересекается — пол не создан");
        return false;
      }
      this.anchor = null;
      this.scene.setPreview(null, null);
      this.setTool("select");
      return true;
    }

    const end = this.room.getPoint(wall.endPointId);
    this.anchor = { xMm: end.xMm, zMm: end.zMm, pointId: end.id };
    this.scene.setPreview(this.anchor, this.anchor);
    return true;
  }

  commitExactLength(lengthMm) {
    if (!this.anchor || !this.previewSnap || lengthMm <= 0) return false;
    const dx = this.previewSnap.point.xMm - this.anchor.xMm;
    const dz = this.previewSnap.point.zMm - this.anchor.zMm;
    const currentLength = Math.hypot(dx, dz);
    if (currentLength < 1) return false;
    const end = {
      xMm: Math.round(this.anchor.xMm + (dx / currentLength) * lengthMm),
      zMm: Math.round(this.anchor.zMm + (dz / currentLength) * lengthMm),
    };
    return this.commitWall(end, null);
  }

  handlePointerUp(event) {
    if (!this.drag) {
      if (this.backgroundPress) {
        const distance = Math.hypot(event.clientX - this.backgroundPress.x, event.clientY - this.backgroundPress.y);
        if (distance < 5) this.selectWall(null);
        this.backgroundPress = null;
      }
      return;
    }
    if (["window", "window-resize-width", "window-resize-height"].includes(this.drag.type)) {
      const item = this.room.getWindow(this.drag.windowId);
      const changes = { wallId: item.wallId, widthMm: item.widthMm, heightMm: item.heightMm, offsetMm: item.offsetMm, sillHeightMm: item.sillHeightMm };
      const original = this.drag.type === "window" ? { wallId: this.drag.fromWallId, offsetMm: this.drag.fromOffsetMm, sillHeightMm: this.drag.fromSillHeightMm }
        : this.drag.type === "window-resize-height" ? { heightMm: this.drag.fromHeightMm }
        : { widthMm: this.drag.fromWidthMm, offsetMm: this.drag.fromOffsetMm };
      const changed = Object.entries(original).some(([key, value]) => changes[key] !== value);
      if (changed) {
        this.room.setWindowProperties(item.id, original);
        this.commands.execute(new ChangeWindowPropertiesCommand(this.room, item.id, changes));
      }
      this.drag = null;
      this.scene.setControlsEnabled(true);
      this.scene.syncRoom(this.room, null, item.id);
      this.onChange?.();
      return;
    }
    if (this.drag.type === "resize-height") {
      const wall = this.room.getWall(this.drag.wallId);
      const heightMm = this.room.getWallHeight(wall);
      if (heightMm !== this.drag.fromHeightMm) {
        wall.heightMm = this.drag.fromHeightMm;
        this.commands.execute(new ChangeWallPropertiesCommand(this.room, wall.id, { heightMm }));
      }
      this.drag = null;
      this.scene.setControlsEnabled(this.tool !== "draw");
      this.scene.syncRoom(this.room, this.selectedWallId);
      this.onChange?.();
      return;
    }
    if (this.drag.type === "wall") {
      const points = this.room.getWallPoints(this.drag.wallId);
      const to = {
        start: { xMm: points.start.xMm, zMm: points.start.zMm },
        end: { xMm: points.end.xMm, zMm: points.end.zMm },
      };
      const moved = to.start.xMm !== this.drag.start.xMm || to.start.zMm !== this.drag.start.zMm;
      if (moved) {
        const wall = this.room.getWall(this.drag.wallId);
        if (wall?.groupId) {
          this.commands.pushExecuted(new StateChangeCommand(
            this.room,
            "Переместить группу",
            this.drag.beforeState,
            this.room.toJSON(),
          ));
        } else {
          this.commands.pushExecuted(new MoveWallCommand(this.room, this.drag.wallId, {
            start: this.drag.start,
            end: this.drag.end,
          }, to));
        }
      }
      this.drag = null;
      this.scene.setControlsEnabled(this.tool !== "draw");
      this.scene.syncRoom(this.room, this.selectedWallId);
      this.onChange?.();
      return;
    }
    const point = this.room.getPoint(this.drag.pointId);
    const to = { xMm: point.xMm, zMm: point.zMm };
    if (this.room.isClosed && polygonSelfIntersects(this.room.getOrderedContourPoints())) {
      this.room.movePoint(this.drag.pointId, this.drag.from.xMm, this.drag.from.zMm);
      this.onToast?.("Точка возвращена: контур не может самопересекаться");
    } else if (to.xMm !== this.drag.from.xMm || to.zMm !== this.drag.from.zMm) {
      this.commands.pushExecuted(new MovePointCommand(this.room, this.drag.pointId, this.drag.from, to));
    }
    this.drag = null;
    this.scene.setControlsEnabled(this.tool !== "draw");
    this.scene.syncRoom(this.room, this.selectedWallId);
    this.onChange?.();
  }

  cancelDraft() {
    if (!this.anchor) return false;
    this.anchor = null;
    this.scene.setPreview(null, null);
    this.onChange?.();
    return true;
  }

  deleteSelectedWall() {
    if (!this.selectionCount()) return;
    [...this.selectedWindowIds].forEach((id) => {
      if (this.room.getWindow(id)) this.commands.execute(new DeleteWindowCommand(this.room, id));
    });
    [...this.selectedWallIds].forEach((id) => {
      if (this.room.getWall(id)) this.commands.execute(new DeleteWallCommand(this.room, id));
    });
    this.selectedWallIds.clear();
    this.selectedWindowIds.clear();
    this.selectedWallId = null;
    this.selectedWindowId = null;
    this.scene.resizeWallId = null;
    this.scene.resizeWindowId = null;
    this.syncSelection();
  }

  groupSelected() {
    if (this.selectionCount() < 2) return false;
    return this.commands.execute(new GroupItemsCommand(
      this.room,
      [...this.selectedWallIds],
      [...this.selectedWindowIds],
    ));
  }

  toggleSelectedLocked() {
    if (!this.selectionCount()) return false;
    const walls = [...this.selectedWallIds].map((id) => this.room.getWall(id)).filter(Boolean);
    const windows = [...this.selectedWindowIds].map((id) => this.room.getWindow(id)).filter(Boolean);
    const lock = ![...walls, ...windows].every((item) => item.locked);
    return this.commands.execute(new SetItemsLockedCommand(
      this.room,
      walls.map((item) => item.id),
      windows.map((item) => item.id),
      lock,
    ));
  }
}
