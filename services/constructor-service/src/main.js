import "./styles/main.css";
import { RoomModel } from "./model/RoomModel.js";
import { CommandManager } from "./core/CommandManager.js";
import { AddDoorCommand, AddStandaloneWallCommand, AddWindowCommand, ChangeRoomSettingsCommand, ChangeWallPropertiesCommand, ChangeWindowPropertiesCommand } from "./commands/commands.js";
import { SnapManager } from "./editor/SnapManager.js";
import { EditorController } from "./editor/EditorController.js";
import { SceneManager } from "./scene/SceneManager.js";
import { EditorUI } from "./ui/EditorUI.js";
import { findFreeWallCenter } from "./geometry/polygon.js";
import { FurnitureRepository } from "./furniture/FurnitureRepository.js";

const room = new RoomModel();
const constructorParams = new URLSearchParams(location.search);
const kitchenProjectId = constructorParams.get("kitchenProject");
const workspaceMode = constructorParams.get("mode") === "layout" ? "layout" : "room";
let kitchenProject = null;
let projectFurniture = [];
let placements = [];
let selectedPlacementId = null;
let projectSaveTimer = null;
let loadingProject = false;
let furnitureDrag = null;
const furnitureRepository = new FurnitureRepository();
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
  onFurniturePointerDown: (event, picked) => {
    const placement = placements.find((item) => item.id === picked.id);
    const ground = scene.getGroundPoint(event);
    if (!placement || !ground) return false;
    selectedPlacementId = placement.id;
    furnitureDrag = {
      placement,
      offsetX: placement.xMm - ground.xMm,
      offsetZ: placement.zMm - ground.zMm,
    };
    scene.setControlsEnabled(false);
    scene.canvas.setPointerCapture?.(event.pointerId);
    renderAll();
    return true;
  },
  onFurniturePointerMove: (event) => {
    if (!furnitureDrag) return false;
    const ground = scene.getGroundPoint(event);
    if (!ground) return true;
    const step = room.snapEnabled ? room.gridStepMm : 10;
    furnitureDrag.placement.moveTo({
      xMm: Math.round((ground.xMm + furnitureDrag.offsetX) / step) * step,
      zMm: Math.round((ground.zMm + furnitureDrag.offsetZ) / step) * step,
    });
    scene.syncFurniture(projectFurniture, placements, selectedPlacementId);
    renderProjectFurniture();
    return true;
  },
  onFurniturePointerUp: () => {
    if (!furnitureDrag) return false;
    furnitureDrag = null;
    scene.setControlsEnabled(controller.tool !== "draw");
    renderAll();
    return true;
  },
});
controller.roomEditingEnabled = workspaceMode === "room";

if (kitchenProjectId) {
  const projectHome = `http://127.0.0.1:8080/company/kitchen-projects/${kitchenProjectId}`;
  const navigationLinks = document.querySelectorAll(".platform-actions a");
  navigationLinks[0].href = projectHome;
  navigationLinks[0].textContent = "← В проект";
  navigationLinks[1].href = `http://127.0.0.1:5174/editor/?new=1&kitchenProject=${kitchenProjectId}`;
}
if (workspaceMode === "layout") {
  document.body.classList.add("layout-workspace");
  ["new-project", "tool-draw", "add-wall", "add-window", "add-doorway", "delete"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.hidden = true;
  });
}

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
  scene.syncFurniture(workspaceMode === "layout" ? projectFurniture : [], workspaceMode === "layout" ? placements : [], selectedPlacementId);
  ui.update(room, controller, commands, scene.viewMode, scene.gridVisible);
  renderProjectFurniture();
  queueProjectSave();
}

function renderProjectFurniture() {
  const section = document.getElementById("project-furniture-section");
  if (!kitchenProjectId || workspaceMode !== "layout") return;
  section.hidden = false;
  document.getElementById("project-furniture-empty").hidden = projectFurniture.length > 0;
  const list = document.getElementById("project-furniture-list");
  list.replaceChildren(...projectFurniture.map((item) => {
    const row = document.createElement("article");
    row.className = "project-furniture-item";
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = item.definition.name;
    const count = document.createElement("small");
    count.textContent = `${(item.revision.document?.entities?.panels?.length ?? 0) + (item.revision.document?.entities?.hardwareInstances?.length ?? 0)} деталей`;
    copy.append(name, count);
    const ownPlacements = placements.filter((placement) => placement.definitionId === item.definition.id);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = ownPlacements.length ? `Добавить ещё · ${ownPlacements.length}` : "Добавить";
    button.addEventListener("click", async () => {
      try {
        const placement = await furnitureRepository.createInstance(kitchenProjectId, item);
        placement.moveTo({ xMm: ownPlacements.length * 700, zMm: 0 });
        await furnitureRepository.saveInstance(kitchenProjectId, placement);
        placements.push(placement);
        selectedPlacementId = placement.id;
        renderAll();
        ui.showToast(`«${item.definition.name}» добавлен в помещение`);
      } catch { ui.showToast("Не удалось добавить мебель"); }
    });
    row.append(copy, button);
    row.addEventListener("click", (event) => {
      if (event.target === button || !ownPlacements.length) return;
      selectedPlacementId = ownPlacements.at(-1).id;
      renderAll();
    });
    row.classList.toggle("selected", ownPlacements.some((placement) => placement.id === selectedPlacementId));
    return row;
  }));
  const selected = placements.find((placement) => placement.id === selectedPlacementId);
  const properties = document.getElementById("placement-properties");
  properties.hidden = !selected;
  if (selected) {
    const furniture = projectFurniture.find((item) => item.definition.id === selected.definitionId);
    document.getElementById("placement-title").textContent = furniture?.definition.name ?? "Размещение";
    document.getElementById("placement-x").value = selected.xMm;
    document.getElementById("placement-z").value = selected.zMm;
    document.getElementById("placement-rotation").value = selected.rotationY;
    const editLink = document.getElementById("edit-furniture");
    editLink.href = `http://127.0.0.1:5174/editor/?project=${selected.definitionId}&kitchenProject=${kitchenProjectId}`;
    const update = document.getElementById("update-furniture");
    update.hidden = !furniture || furniture.revision.id === selected.revisionId;
  }
}

function updatePlacement(changes) {
  const selected = placements.find((placement) => placement.id === selectedPlacementId);
  if (!selected) return;
  selected.moveTo(changes);
  renderAll();
}

["x", "z", "rotation"].forEach((key) => {
  document.getElementById(`placement-${key}`).addEventListener("change", (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return renderAll();
    updatePlacement(key === "rotation" ? { rotationY: value } : { [`${key}Mm`]: value });
  });
});
document.getElementById("remove-placement").addEventListener("click", async () => {
  if (selectedPlacementId) await furnitureRepository.deleteInstance(kitchenProjectId, selectedPlacementId).catch(() => {});
  placements = placements.filter((placement) => placement.id !== selectedPlacementId);
  selectedPlacementId = null;
  renderAll();
});
document.getElementById("update-furniture").addEventListener("click", async () => {
  const selected = placements.find((placement) => placement.id === selectedPlacementId);
  const furniture = selected && projectFurniture.find((item) => item.definition.id === selected.definitionId);
  if (!selected || !furniture || furniture.revision.id === selected.revisionId) return;
  try {
    const { preview } = await furnitureRepository.previewUpdate(kitchenProjectId, selected.id, furniture.revision.id);
    if (!preview.valid) {
      ui.showToast(preview.violations.some((item) => item.code === "INSTANCE_COLLISION")
        ? "Обновление пересекается с другой мебелью" : "Обновление не помещается в комнате");
      return;
    }
    const result = await furnitureRepository.applyUpdate(kitchenProjectId, selected.id, furniture.revision.id);
    selected.revisionId = result.instance.revisionId;
    selected.transform = result.instance.transform;
    renderAll();
    ui.showToast("Экземпляр обновлён до новой ревизии");
  } catch (error) {
    const preview = error.data?.preview;
    ui.showToast(preview ? "Новая ревизия не может быть размещена безопасно" : "Не удалось обновить мебель");
  }
});

async function loadKitchenProject() {
  if (!kitchenProjectId) return;
  loadingProject = true;
  try {
    const loaded = await furnitureRepository.loadKitchen(kitchenProjectId);
    kitchenProject = loaded.kitchen;
    projectFurniture = loaded.definitions;
    placements = loaded.instances;
    if (Array.isArray(kitchenProject.roomData?.walls)) room.restore(kitchenProject.roomData);
    const title = document.getElementById("kitchen-project-title");
    title.textContent = `${kitchenProject.name} · ${workspaceMode === "layout" ? "Общая сцена" : "Помещение"}`;
    title.hidden = false;
    document.title = `${kitchenProject.name} — ${workspaceMode === "layout" ? "Общая сцена" : "Помещение"}`;
  } catch {
    ui.showToast("Не удалось открыть проект кухни");
  } finally {
    loadingProject = false;
    renderAll();
  }
}

function queueProjectSave() {
  if (!kitchenProjectId || loadingProject || !kitchenProject) return;
  clearTimeout(projectSaveTimer);
  projectSaveTimer = setTimeout(async () => {
    try {
      if (workspaceMode === "layout") {
        await Promise.all(placements.map((placement) => furnitureRepository.saveInstance(kitchenProjectId, placement)));
      } else {
        await furnitureRepository.saveKitchen(kitchenProjectId, { name: kitchenProject.name, roomData: room.toJSON() });
      }
    } catch { ui.showToast("Не удалось сохранить проект кухни"); }
  }, 800);
}

document.getElementById("refresh-project-furniture").addEventListener("click", loadKitchenProject);

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
loadKitchenProject();
