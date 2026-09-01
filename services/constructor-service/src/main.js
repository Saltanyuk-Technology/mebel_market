import "./styles/main.css";
import { RoomModel } from "./model/RoomModel.js";
import { CommandManager } from "./core/CommandManager.js";
import { AddDoorCommand, AddStandaloneWallCommand, AddWindowCommand, ChangeRoomSettingsCommand, ChangeWallPropertiesCommand, ChangeWindowPropertiesCommand } from "./commands/commands.js";
import { SnapManager } from "./editor/SnapManager.js";
import { EditorController } from "./editor/EditorController.js";
import { SceneManager } from "./scene/SceneManager.js";
import { EditorUI } from "./ui/EditorUI.js";
import { findFreeWallCenter } from "./geometry/polygon.js";

const room = new RoomModel();
const ui = new EditorUI();
const scene = new SceneManager(
  document.getElementById("scene-canvas"),
  document.getElementById("dimensions"),
);
const snap = new SnapManager();

let controller;
const commands = new CommandManager(() => renderAll());

controller = new EditorController({
  room,
  scene,
  commands,
  snap,
  onChange: () => renderAll(),
  onCursor: (point, kind, length, event) => ui.updateCursor(point, kind, length, event),
  onToolChange: () => renderAll(),
  onToast: (message) => ui.showToast(message),
});

function renderAll() {
  controller.selectedWallIds = new Set([...controller.selectedWallIds].filter((id) => room.getWall(id)));
  controller.selectedWindowIds = new Set([...controller.selectedWindowIds].filter((id) => room.getWindow(id)));
  if (controller.selectedWallId && !room.getWall(controller.selectedWallId)) {
    controller.selectedWallId = null;
  }
  if (controller.selectedWindowId && !room.getWindow(controller.selectedWindowId)) controller.selectedWindowId = null;
  scene.selectedWallIds = new Set(controller.selectedWallIds);
  scene.selectedWindowIds = new Set(controller.selectedWindowIds);
  scene.syncRoom(room, controller.selectedWallId, controller.selectedWindowId);
  ui.update(room, controller, commands, scene.viewMode, scene.gridVisible);
}

function setTool(tool) {
  if (tool === "draw" && scene.viewMode !== "top") setView("top");
  controller.setTool(tool);
}

function setView(mode) {
  if (mode === "3d" && controller.tool === "draw") controller.setTool("select");
  scene.setView(mode);
  renderAll();
}

function changeRoom(changes) {
  const entries = Object.entries(changes).filter(([, value]) => typeof value === "boolean" || (Number.isFinite(value) && value > 0));
  if (!entries.length) {
    ui.showToast("Введите положительное числовое значение");
    renderAll();
    return;
  }
  commands.execute(new ChangeRoomSettingsCommand(room, Object.fromEntries(entries)));
}

function deleteWall() {
  controller.deleteSelectedWall();
}

function addWall() {
  const center = findFreeWallCenter(room, scene.getViewCenterMm());
  if (!center) {
    ui.showToast("Не удалось найти свободное место для новой стены");
    return;
  }
  const command = new AddStandaloneWallCommand(room, center);
  if (!commands.execute(command)) {
    ui.showToast("Не удалось добавить стену в найденное свободное место");
    return;
  }
  controller.setTool("select");
  controller.setSelectedWall(command.createdWallId);
}

function addWindow() {
  const wall = (controller.selectedWallId && room.getWall(controller.selectedWallId)) || room.walls.at(-1);
  if (!wall) {
    ui.showToast("Сначала добавьте стену");
    return;
  }
  const command = new AddWindowCommand(room, wall.id);
  if (!commands.execute(command)) {
    ui.showToast("На этой стене нет свободного места для ещё одного окна");
    return;
  }
  controller.setTool("select");
  controller.selectWindow(command.createdWindowId);
}

function addDoor() {
  const wall = (controller.selectedWallId && room.getWall(controller.selectedWallId)) || room.walls.at(-1);
  if (!wall) {
    ui.showToast("Сначала добавьте стену");
    return;
  }
  const command = new AddDoorCommand(room, wall.id);
  if (!commands.execute(command)) {
    ui.showToast("На этой стене нет свободного места для дверного проёма");
    return;
  }
  controller.setTool("select");
  controller.selectWindow(command.createdDoorId);
}

function changeWall(changes) {
  if (!controller.selectedWallId) return;
  if (room.getWall(controller.selectedWallId)?.locked) {
    ui.showToast("Деталь закреплена");
    return;
  }
  const valid = Object.entries(changes).every(([key, value]) => Number.isFinite(value) && (key === "angleDeg" || value > 0));
  if (!valid) {
    ui.showToast("Введите корректное числовое значение");
    renderAll();
    return;
  }
  if (!commands.execute(new ChangeWallPropertiesCommand(room, controller.selectedWallId, changes))) {
    ui.showToast("Стены не могут пересекаться");
  }
}

function changeWindow(changes) {
  if (!controller.selectedWindowId) return;
  if (room.getWindow(controller.selectedWindowId)?.locked) {
    ui.showToast("Деталь закреплена");
    return;
  }
  commands.execute(new ChangeWindowPropertiesCommand(room, controller.selectedWindowId, changes));
}

const newProjectModal = document.getElementById("new-project-modal");

function resetProject() {
    room.reset();
    commands.clear();
    controller.resetTransientState();
    controller.setTool("select");
    renderAll();
}

function closeNewProjectModal() {
  newProjectModal.hidden = true;
}

document.getElementById("cancel-new-project").addEventListener("click", closeNewProjectModal);
document.getElementById("confirm-new-project").addEventListener("click", () => {
  closeNewProjectModal();
  resetProject();
});
newProjectModal.addEventListener("pointerdown", (event) => {
  if (event.target === newProjectModal) closeNewProjectModal();
});

ui.bind({
  newProject: () => {
    if (!room.walls.length) {
      resetProject();
      return;
    }
    newProjectModal.hidden = false;
    document.getElementById("cancel-new-project").focus();
  },
  setTool,
  undo: () => {
    controller.anchor = null;
    scene.setPreview(null, null);
    commands.undo();
  },
  redo: () => {
    controller.anchor = null;
    scene.setPreview(null, null);
    commands.redo();
  },
  deleteWall,
  addWall,
  addWindow,
  addDoor,
  clearSelection: () => controller.setSelectedWall(null),
  setView,
  toggleGrid: () => {
    scene.setGridVisible(!scene.gridVisible);
    renderAll();
  },
  toggleSnap: () => changeRoom({ snapEnabled: !room.snapEnabled }),
  changeRoom,
  changeWall,
  changeWindow,
  groupSelection: () => {
    if (!controller.groupSelected()) ui.showToast("Выберите минимум две детали");
  },
  toggleSelectionLocked: () => controller.toggleSelectedLocked(),
  rotateWall: (deltaDeg) => {
    const wall = controller.selectedWallId ? room.getWall(controller.selectedWallId) : null;
    if (wall) changeWall({ angleDeg: room.getWallAngleDeg(wall) + deltaDeg });
  },
  exactLength: (lengthMm) => {
    if (!controller.commitExactLength(lengthMm)) ui.showToast("Не удалось применить точную длину");
  },
});

window.addEventListener("keydown", (event) => {
  const editing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (event.key === "Escape") {
    if (!newProjectModal.hidden) closeNewProjectModal();
    else if (ui.lengthInputOpen) ui.hideLengthInput();
    else controller.cancelDraft();
    return;
  }
  if (editing) return;

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? commands.redo() : commands.undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    commands.redo();
    return;
  }
  if (event.key === "Delete") deleteWall();
  if (event.key.toLowerCase() === "b") setTool("draw");
  if (event.key.toLowerCase() === "v") setTool("select");
  if (event.key === "Enter" && controller.tool === "draw" && controller.anchor && controller.previewSnap) {
    const start = controller.anchor;
    const end = controller.previewSnap.point;
    ui.showLengthInput(Math.hypot(end.xMm - start.xMm, end.zMm - start.zMm));
  }
});

renderAll();
