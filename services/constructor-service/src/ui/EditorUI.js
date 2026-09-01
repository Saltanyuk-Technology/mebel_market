import { formatMm } from "../core/units.js";

const byId = (id) => document.getElementById(id);

export class EditorUI {
  constructor() {
    this.elements = {
      draw: byId("tool-draw"), select: byId("tool-select"), undo: byId("undo"), redo: byId("redo"), delete: byId("delete"),
      top: byId("view-top"), view3d: byId("view-3d"), grid: byId("toggle-grid"), snap: byId("toggle-snap"),
      roomPanel: byId("room-properties"), wallPanel: byId("wall-properties"), windowPanel: byId("window-properties"), multiPanel: byId("multi-properties"), multiList: byId("multi-selection-list"), groupSelection: byId("group-selection"), lockSelection: byId("lock-selection"), panelTitle: byId("panel-title"), chip: byId("selection-chip"),
      selectedHeight: byId("selected-height"), wallLength: byId("wall-length"), wallThickness: byId("wall-thickness"), wallAngle: byId("wall-angle"),
      windowWidth: byId("window-width"), windowHeight: byId("window-height"), windowSill: byId("window-sill"), windowSillField: byId("window-sill-field"),
      openingPropertiesTitle: byId("opening-properties-title"), openingHelpText: byId("opening-help-text"), deleteOpening: byId("delete-window-panel"),
      statusTool: byId("status-tool"), statusX: byId("status-x"), statusZ: byId("status-z"), statusLength: byId("status-length"), statusWalls: byId("status-walls"), statusContour: byId("status-contour"),
      cursorBadge: byId("cursor-badge"), toast: byId("toast"), lengthPopover: byId("length-popover"), exactLength: byId("exact-length"),
    };
    this.toastTimer = null;
  }

  bind(handlers) {
    byId("new-project").addEventListener("click", handlers.newProject);
    this.elements.draw.addEventListener("click", () => handlers.setTool("draw"));
    this.elements.select.addEventListener("click", () => handlers.setTool("select"));
    this.elements.undo.addEventListener("click", handlers.undo);
    this.elements.redo.addEventListener("click", handlers.redo);
    this.elements.delete.addEventListener("click", handlers.deleteWall);
    byId("delete-wall-panel").addEventListener("click", handlers.deleteWall);
    byId("add-wall").addEventListener("click", handlers.addWall);
    byId("add-window").addEventListener("click", handlers.addWindow);
    byId("add-doorway").addEventListener("click", handlers.addDoor);
    byId("back-to-room").addEventListener("click", handlers.clearSelection);
    byId("back-from-window").addEventListener("click", handlers.clearSelection);
    byId("back-from-multi").addEventListener("click", handlers.clearSelection);
    this.elements.groupSelection.addEventListener("click", handlers.groupSelection);
    this.elements.lockSelection.addEventListener("click", handlers.toggleSelectionLocked);
    byId("delete-window-panel").addEventListener("click", handlers.deleteWall);
    this.elements.top.addEventListener("click", () => handlers.setView("top"));
    this.elements.view3d.addEventListener("click", () => handlers.setView("3d"));
    this.elements.grid.addEventListener("click", handlers.toggleGrid);
    this.elements.snap.addEventListener("click", handlers.toggleSnap);
    this.elements.selectedHeight.addEventListener("change", () => handlers.changeWall({ heightMm: this.numberValue(this.elements.selectedHeight) }));
    this.elements.wallLength.addEventListener("change", () => handlers.changeWall({ visibleLengthMm: this.numberValue(this.elements.wallLength) }));
    this.elements.wallThickness.addEventListener("change", () => handlers.changeWall({ thicknessMm: this.numberValue(this.elements.wallThickness) }));
    this.elements.wallAngle.addEventListener("change", () => handlers.changeWall({ angleDeg: this.numberValue(this.elements.wallAngle) }));
    this.elements.windowWidth.addEventListener("change", () => handlers.changeWindow({ widthMm: this.numberValue(this.elements.windowWidth) }));
    this.elements.windowHeight.addEventListener("change", () => handlers.changeWindow({ heightMm: this.numberValue(this.elements.windowHeight) }));
    this.elements.windowSill.addEventListener("change", () => handlers.changeWindow({ sillHeightMm: this.numberValue(this.elements.windowSill) }));
    document.querySelectorAll("[data-rotate]").forEach((button) => {
      button.addEventListener("click", () => handlers.rotateWall(Number(button.dataset.rotate)));
    });
    this.elements.lengthPopover.addEventListener("submit", (event) => {
      event.preventDefault();
      handlers.exactLength(this.numberValue(this.elements.exactLength));
      this.hideLengthInput();
    });
  }

  numberValue(input) { return Number(input.value); }

  update(room, controller, commands, viewMode, gridVisible) {
    const wall = controller.selectedWallId ? room.getWall(controller.selectedWallId) : null;
    const windowItem = controller.selectedWindowId ? room.getWindow(controller.selectedWindowId) : null;
    const selectedCount = controller.selectionCount();
    const multiple = selectedCount > 1;
    this.elements.roomPanel.hidden = selectedCount > 0;
    this.elements.wallPanel.hidden = !wall || multiple;
    this.elements.windowPanel.hidden = !windowItem || multiple;
    this.elements.multiPanel.hidden = !multiple;
    const openingName = windowItem?.kind === "door" ? "Дверной проём" : "Окно";
    this.elements.panelTitle.textContent = multiple ? `Выбрано: ${selectedCount}` : windowItem ? openingName : wall ? "Стена" : "Помещение";
    this.elements.chip.textContent = multiple ? `${selectedCount} дет.` : wall || windowItem ? "Выбрано" : "Элементы";
    this.elements.draw.classList.toggle("active", controller.tool === "draw");
    this.elements.select.classList.toggle("active", controller.tool === "select");
    this.elements.draw.setAttribute("aria-pressed", String(controller.tool === "draw"));
    this.elements.select.setAttribute("aria-pressed", String(controller.tool === "select"));
    this.elements.top.classList.toggle("active", viewMode === "top");
    this.elements.view3d.classList.toggle("active", viewMode === "3d");
    this.elements.grid.classList.toggle("active", gridVisible);
    this.elements.snap.classList.toggle("active", room.snapEnabled);
    this.elements.undo.disabled = !commands.canUndo;
    this.elements.redo.disabled = !commands.canRedo;
    this.elements.delete.disabled = selectedCount === 0;
    this.elements.statusWalls.textContent = room.walls.length;
    this.elements.statusTool.textContent = controller.tool === "draw" ? "Построение" : "Выбор";
    this.elements.statusContour.textContent = room.isClosed ? "Контур замкнут" : "Контур открыт";
    this.elements.statusContour.classList.toggle("closed", room.isClosed);
    if (wall) this.updateWall(room, wall);
    if (windowItem) this.updateWindow(windowItem);
    if (multiple) this.updateMultiSelection(room, controller);
    const selectedItems = [
      ...[...controller.selectedWallIds].map((id) => room.getWall(id)).filter(Boolean),
      ...[...controller.selectedWindowIds].map((id) => room.getWindow(id)).filter(Boolean),
    ];
    const allLocked = selectedItems.length > 0 && selectedItems.every((item) => item.locked);
    this.elements.lockSelection.textContent = allLocked ? "Открепить" : "Закрепить";
    this.elements.lockSelection.classList.toggle("active", allLocked);
  }

  updateMultiSelection(room, controller) {
    const items = [];
    controller.selectedWallIds.forEach((id) => {
      const wall = room.getWall(id);
      if (!wall) return;
      items.push({
        title: `Стена ${room.walls.findIndex((item) => item.id === id) + 1}`,
        details: `${Math.round(room.getWallVisibleLength(wall))} × ${room.getWallHeight(wall)} × ${room.getWallThickness(wall)} мм${wall.locked ? " · закреплена" : ""}`,
      });
    });
    controller.selectedWindowIds.forEach((id) => {
      const item = room.getWindow(id);
      if (!item) return;
      const isDoor = item.kind === "door";
      const sameKindIndex = room.windows.filter((opening) => opening.kind === item.kind).findIndex((opening) => opening.id === id) + 1;
      items.push({
        title: `${isDoor ? "Дверной проём" : "Окно"} ${sameKindIndex}`,
        details: `${item.widthMm} × ${item.heightMm} мм${item.locked ? isDoor ? " · закреплён" : " · закреплено" : ""}`,
      });
    });
    this.elements.multiList.replaceChildren(...items.map((item) => {
      const row = document.createElement("div");
      row.className = "multi-selection-item";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const details = document.createElement("small");
      details.textContent = item.details;
      row.append(title, details);
      return row;
    }));
  }

  updateWindow(item) {
    const isDoor = item.kind === "door";
    this.elements.windowWidth.value = item.widthMm;
    this.elements.windowHeight.value = item.heightMm;
    this.elements.windowSill.value = item.sillHeightMm;
    this.elements.windowSillField.hidden = isDoor;
    this.elements.openingPropertiesTitle.textContent = isDoor ? "Размеры дверного проёма" : "Размеры окна";
    this.elements.openingHelpText.textContent = isDoor
      ? "Зажмите дверной проём и перемещайте его по стене или перенесите на другую стену. Размерные линии показывают расстояния до краёв. Двойной клик включает изменение ширины и высоты."
      : "Зажмите окно и перемещайте его по стене или перенесите на другую стену. Размерные линии показывают расстояния до краёв. Двойной клик включает изменение ширины и высоты.";
    this.elements.deleteOpening.textContent = isDoor ? "Удалить дверной проём" : "Удалить окно";
  }

  updateWall(room, wall) {
    this.elements.wallLength.value = Math.round(room.getWallVisibleLength(wall));
    this.elements.selectedHeight.value = room.getWallHeight(wall);
    this.elements.wallThickness.value = room.getWallThickness(wall);
    this.elements.wallAngle.value = room.getWallAngleDeg(wall);
  }

  updateCursor(point, snapKind, length, event) {
    this.elements.statusX.textContent = point.xMm;
    this.elements.statusZ.textContent = point.zMm;
    this.elements.statusLength.textContent = length == null ? "—" : formatMm(length);
    if (snapKind && event) {
      const rect = byId("viewport").getBoundingClientRect();
      this.elements.cursorBadge.hidden = false;
      this.elements.cursorBadge.textContent = snapKind;
      this.elements.cursorBadge.style.left = `${event.clientX - rect.left + 16}px`;
      this.elements.cursorBadge.style.top = `${event.clientY - rect.top + 16}px`;
    } else {
      this.elements.cursorBadge.hidden = true;
    }
  }

  showToast(message) {
    clearTimeout(this.toastTimer);
    this.elements.toast.textContent = message;
    this.elements.toast.hidden = false;
    this.toastTimer = setTimeout(() => { this.elements.toast.hidden = true; }, 3000);
  }

  showLengthInput(suggestedLength) {
    this.elements.lengthPopover.hidden = false;
    this.elements.exactLength.value = Math.max(1, Math.round(suggestedLength || 1000));
    requestAnimationFrame(() => this.elements.exactLength.select());
  }

  hideLengthInput() { this.elements.lengthPopover.hidden = true; }
  get lengthInputOpen() { return !this.elements.lengthPopover.hidden; }
}
