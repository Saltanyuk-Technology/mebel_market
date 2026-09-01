import "./styles.css";
import { constrainMeasurementPoint, FurnitureModel, getConfirmatPlacement, History } from "./model.js";
import { FurnitureScene } from "./scene.js";

const byId = (id) => document.getElementById(id);
const STORAGE_KEY = "mebel-furniture-editor-workspace-v1";
const PROJECT_API = "/api/furniture-projects";
const editorUrlParams = new URLSearchParams(location.search);
let currentProjectId = editorUrlParams.get("project");
let currentProjectName = "";
let draftId = editorUrlParams.get("draft");
if (editorUrlParams.get("new") === "1") {
  draftId = crypto.randomUUID();
  window.history.replaceState({}, "", `${location.pathname}?draft=${draftId}`);
}
let localWorkspaceKey = currentProjectId
  ? `${STORAGE_KEY}-project-${currentProjectId}`
  : draftId ? `${STORAGE_KEY}-draft-${draftId}` : STORAGE_KEY;
let serverAutosaveTimer = null;

function loadWorkspace(storageKey = STORAGE_KEY) {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) ?? null;
  } catch {
    return null;
  }
}

const savedWorkspace = currentProjectId ? null : loadWorkspace(localWorkspaceKey);
const model = new FurnitureModel();
if (savedWorkspace?.model) model.restore(savedWorkspace.model);
const selectedIds = new Set(savedWorkspace?.selectedIds ?? []);
let selectedConnectionId = savedWorkspace?.selectedConnectionId ?? null;
let selectedConnectionPointIndex = Number.isInteger(savedWorkspace?.selectedConnectionPointIndex)
  ? savedWorkspace.selectedConnectionPointIndex
  : null;
let selectionPinned = Boolean(savedWorkspace?.selectionPinned);
let showAllDimensions = Boolean(savedWorkspace?.showAllDimensions);
const assemblyNames = { ...(savedWorkspace?.assemblyNames ?? {}) };
const rulerSettings = {
  snapToSurfaces: savedWorkspace?.rulerSettings?.snapToSurfaces !== false,
  snapToGrid: savedWorkspace?.rulerSettings?.snapToGrid !== false,
  axisLock: savedWorkspace?.rulerSettings?.axisLock !== false,
};
const scene = new FurnitureScene(byId("scene-canvas"), byId("dimensions"));
scene.setShowAllPartDimensions(showAllDimensions);
scene.setRulerSettings(rulerSettings);
if (savedWorkspace?.view) scene.restoreViewState(savedWorkspace.view);
let drag = null;
let toastTimer = null;
let suppressNextCanvasClick = false;
let rulerActive = false;
let measurementPoints = [];
const cameraKeys = new Set();
const cameraCodeMap = {
  KeyW: "w",
  KeyA: "a",
  KeyS: "s",
  KeyD: "d",
};
let previousCameraFrame = performance.now();

const history = new History(model, () => {
  cleanSelection();
  render();
});
history.undoStack = Array.isArray(savedWorkspace?.undoStack) ? savedWorkspace.undoStack : [];
history.redoStack = Array.isArray(savedWorkspace?.redoStack) ? savedWorkspace.redoStack : [];

function workspaceData() {
  return {
    model: model.toJSON(),
    selectedIds: [...selectedIds],
    selectedConnectionId,
    selectedConnectionPointIndex,
    selectionPinned,
    showAllDimensions,
    assemblyNames,
    rulerSettings,
    view: scene.getViewState(),
    undoStack: history.undoStack,
    redoStack: history.redoStack,
  };
}

function saveWorkspace() {
  try {
    localStorage.setItem(localWorkspaceKey, JSON.stringify(workspaceData()));
  } catch {
    // The editor remains usable if browser storage is unavailable or full.
  }
  queueServerAutosave();
}
scene.controls.addEventListener("end", saveWorkspace);

function cleanSelection() {
  [...selectedIds].forEach((id) => {
    if (!model.getPart(id)) selectedIds.delete(id);
  });
  if (selectedConnectionId && !model.getConnection(selectedConnectionId)) {
    selectedConnectionId = null;
    selectedConnectionPointIndex = null;
  }
  if (!selectedIds.size && !selectedConnectionId) selectionPinned = false;
}

function render() {
  cleanSelection();
  scene.sync(model, selectedIds, selectedConnectionId, selectedConnectionPointIndex);
  const selected = [...selectedIds].map((id) => model.getPart(id)).filter(Boolean);
  const selectedConnection = selectedConnectionId ? model.getConnection(selectedConnectionId) : null;
  const pairConnection = selected.length === 2
    ? model.getConnectionBetween(selected.map((part) => part.id))
    : null;
  const single = selected.length === 1 ? selected[0] : null;
  byId("empty-properties").hidden = selected.length > 0 || Boolean(selectedConnection);
  byId("part-properties").hidden = !single;
  byId("multi-properties").hidden = selected.length < 2;
  byId("panel-title").textContent = selectedConnection
    ? "Конфирмат"
    : single ? single.name : selected.length > 1 ? `Выбрано: ${selected.length}` : "Модель";
  byId("selection-chip").textContent = `${model.parts.length} дет.`;
  byId("status-count").textContent = model.parts.length;
  byId("undo").disabled = history.undoStack.length === 0;
  byId("redo").disabled = history.redoStack.length === 0;
  byId("duplicate").disabled = Boolean(selectedConnection)
    || selected.length === 0
    || selected.some((part) => part.lockedTo);
  byId("delete").disabled = !selectedConnection && selected.length === 0;
  byId("view-top").classList.toggle("active", scene.viewMode === "top");
  byId("view-3d").classList.toggle("active", scene.viewMode === "3d");
  byId("ruler").classList.toggle("active", rulerActive);
  byId("pin-selection").checked = selectionPinned;
  byId("show-all-dimensions").checked = showAllDimensions;
  byId("pin-selection").disabled = selected.length === 0 && !selectedConnection;
  byId("connect-parts").hidden = !(
    selected.length === 2 && selected.every((part) => part.kind !== "hardware")
  );
  byId("connect-parts").textContent = pairConnection ? "Разъединить детали" : "Соединить детали";
  if (single) updatePartPanel(single);
  if (selected.length > 1) updateMultiPanel(selected);
  updateScenePartsList();
  saveWorkspace();
}

function updateScenePartsList() {
  const list = byId("scene-parts-list");
  byId("scene-parts-count").textContent = model.parts.length;
  if (!model.parts.length) {
    const empty = document.createElement("div");
    empty.className = "scene-parts-empty";
    empty.textContent = "Добавленные детали появятся здесь";
    list.replaceChildren(empty);
    return;
  }
  let assemblyNumber = 0;
  const rows = getScenePartGroups().map((group) => {
    if (group.parts.length > 1) {
      assemblyNumber += 1;
      const selected = group.parts.every((part) => selectedIds.has(part.id));
      const row = document.createElement("div");
      row.className = `scene-assembly${selected ? " active" : ""}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scene-part scene-assembly-select";
      button.dataset.assemblyIds = group.parts.map((part) => part.id).join(",");
      button.setAttribute("aria-pressed", String(selected));
      const icon = document.createElement("span");
      icon.className = "scene-part-icon";
      icon.textContent = "◇";
      const copy = document.createElement("span");
      copy.className = "scene-part-copy";
      const name = document.createElement("strong");
      name.textContent = assemblyNames[group.key] || `Сборка ${assemblyNumber}`;
      const details = document.createElement("small");
      details.textContent = `${group.parts.length} дет. · ${group.parts.map((part) => part.name).join(", ")}`;
      copy.append(name, details);
      const arrow = document.createElement("b");
      arrow.textContent = selected ? "✓" : "→";
      button.append(icon, copy, arrow);
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "scene-assembly-rename";
      rename.dataset.renameAssembly = group.key;
      rename.dataset.defaultName = name.textContent;
      rename.title = "Переименовать сборку";
      rename.setAttribute("aria-label", `Переименовать ${name.textContent}`);
      rename.textContent = "✎";
      row.append(button, rename);
      return row;
    }
    const part = group.parts[0];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `scene-part${selectedIds.has(part.id) ? " active" : ""}`;
    button.dataset.partId = part.id;
    button.setAttribute("aria-pressed", String(selectedIds.has(part.id)));
    const icon = document.createElement("span");
    icon.className = "scene-part-icon";
    icon.textContent = part.kind === "hardware" ? "●" : part.partType === "side" ? "▯" : "▱";
    const copy = document.createElement("span");
    copy.className = "scene-part-copy";
    const name = document.createElement("strong");
    name.textContent = part.name;
    const size = document.createElement("small");
    size.textContent = `${part.sizeX} × ${part.sizeY} × ${part.sizeZ} мм`;
    copy.append(name, size);
    const arrow = document.createElement("b");
    arrow.textContent = selectedIds.has(part.id) ? "✓" : "→";
    button.append(icon, copy, arrow);
    return button;
  });
  list.replaceChildren(...rows);
}

function getScenePartGroups() {
  const byPartId = new Map(model.parts.map((part) => [part.id, part]));
  const links = new Map(model.parts.map((part) => [part.id, new Set()]));
  const connect = (firstId, secondId) => {
    if (!links.has(firstId) || !links.has(secondId)) return;
    links.get(firstId).add(secondId);
    links.get(secondId).add(firstId);
  };
  model.connections.forEach((connection) => {
    connection.partIds.forEach((id, index) => {
      connection.partIds.slice(index + 1).forEach((otherId) => connect(id, otherId));
    });
  });
  model.parts.forEach((part) => {
    const ownerId = part.lockedTo ?? part.attachedTo;
    if (ownerId) connect(part.id, ownerId);
  });
  const visited = new Set();
  return model.parts.map((part) => {
    if (visited.has(part.id)) return null;
    const ids = [];
    const pending = [part.id];
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      ids.push(id);
      links.get(id)?.forEach((linkedId) => pending.push(linkedId));
    }
    ids.sort();
    return { key: ids.join("|"), parts: ids.map((id) => byPartId.get(id)).filter(Boolean) };
  }).filter(Boolean);
}

function selectPartIds(ids, additive = false) {
  selectedConnectionId = null;
  selectedConnectionPointIndex = null;
  scene.setOrientationEditor(null);
  const validIds = ids.filter((id) => model.getPart(id));
  if (!additive) selectedIds.clear();
  const remove = additive && validIds.every((id) => selectedIds.has(id));
  validIds.forEach((id) => remove ? selectedIds.delete(id) : selectedIds.add(id));
  render();
}

function updatePartPanel(part) {
  const isLeg = part.hardwareType === "leg";
  const isFurniturePart = part.kind !== "hardware";
  const supportsPartType = isFurniturePart && part.material !== "hdf-4";
  const isLocked = Boolean(part.lockedTo);
  const isConnected = isFurniturePart && model.getConnectedPartIds(part.id).length > 1;
  byId("part-name").value = part.name;
  byId("part-type-section").hidden = !supportsPartType;
  byId("part-type").value = part.partType ?? "shelf";
  byId("leg-config-actions").hidden = !isFurniturePart || part.partType !== "bottom";
  byId("size-x").value = part.sizeX;
  byId("size-x").disabled = isLeg || isConnected;
  byId("size-y").value = part.sizeY;
  byId("size-y").disabled = isFurniturePart || isLeg || isConnected;
  byId("size-z").value = part.sizeZ;
  byId("size-z").disabled = isLeg || isConnected;
  byId("size-x-label").textContent = isLeg ? "Диаметр X" : "Длина X";
  byId("size-y-label").textContent = isLeg ? "Высота Y" : "Толщина Y";
  byId("size-z-label").textContent = isLeg ? "Диаметр Z" : "Ширина Z";
  byId("pos-x").value = part.xMm;
  byId("pos-x").disabled = isLocked;
  byId("pos-y").value = part.yMm;
  byId("pos-y").disabled = isLocked;
  byId("pos-z").value = part.zMm;
  byId("pos-z").disabled = isLocked;
  document.querySelectorAll("[data-rotate-axis]").forEach((button) => {
    button.disabled = isLocked || isConnected;
  });
  byId("status-x").textContent = part.xMm;
  byId("status-y").textContent = part.yMm;
  byId("status-z").textContent = part.zMm;
}

function updateMultiPanel(parts) {
  byId("multi-list").replaceChildren(...parts.map((part) => {
    const row = document.createElement("div");
    row.className = "multi-item";
    const name = document.createElement("strong");
    name.textContent = part.name;
    const size = document.createElement("small");
    size.textContent = `${part.sizeX} × ${part.sizeY} × ${part.sizeZ} мм`;
    row.append(name, size);
    return row;
  }));
}

function select(id, additive = false) {
  selectedConnectionId = null;
  selectedConnectionPointIndex = null;
  const part = id ? model.getPart(id) : null;
  const ids = part?.groupId
    ? model.parts.filter((item) => item.groupId === part.groupId).map((item) => item.id)
    : id ? [id] : [];
  if (!id || (scene.orientationPartId && !ids.includes(scene.orientationPartId))) {
    scene.setOrientationEditor(null);
  }
  if (!additive) selectedIds.clear();
  if (ids.length) {
    const remove = additive && ids.every((itemId) => selectedIds.has(itemId));
    ids.forEach((itemId) => remove ? selectedIds.delete(itemId) : selectedIds.add(itemId));
  }
  render();
}

function selectConnection(id, pointIndex = 0) {
  const connection = model.getConnection(id);
  if (!connection) return;
  selectedConnectionId = id;
  selectedConnectionPointIndex = pointIndex;
  selectedIds.clear();
  scene.setOrientationEditor(null);
  render();
}

function showToast(message) {
  clearTimeout(toastTimer);
  byId("toast").textContent = message;
  byId("toast").hidden = false;
  toastTimer = setTimeout(() => { byId("toast").hidden = true; }, 1800);
}

function clearSelectionIfAllowed() {
  if (selectionPinned) {
    showToast("Сначала снимите закрепление выделения");
    return;
  }
  select(null);
}

const addPartModal = byId("add-part-modal");
const addPartForm = byId("add-part-form");
const hardwareModal = byId("hardware-modal");
const legsModal = byId("legs-modal");
const legsForm = byId("legs-form");
const connectionModal = byId("connection-modal");
const connectionForm = byId("connection-form");
const renameAssemblyModal = byId("rename-assembly-modal");
const renameAssemblyForm = byId("rename-assembly-form");
const saveProjectModal = byId("save-project-modal");
const saveProjectForm = byId("save-project-form");
let legsBottomId = null;
let connectionPartIds = [];
let renamedAssemblyKey = null;

function openAddPartModal() {
  byId("part-material").dispatchEvent(new Event("change"));
  addPartModal.hidden = false;
  byId("part-length").focus();
  byId("part-length").select();
}

function closeAddPartModal() {
  addPartModal.hidden = true;
}

function openHardwareModal() {
  hardwareModal.hidden = false;
}

function closeHardwareModal() {
  hardwareModal.hidden = true;
}

function openLegsModal() {
  if (selectedIds.size !== 1) return;
  const part = model.getPart([...selectedIds][0]);
  if (!part || part.partType !== "bottom") return;
  legsBottomId = part.id;
  legsModal.hidden = false;
  byId("legs-inset").focus();
  byId("legs-inset").select();
}

function closeLegsModal() {
  legsModal.hidden = true;
  legsBottomId = null;
}

function openConnectionModal() {
  const selected = [...selectedIds].map((id) => model.getPart(id)).filter(Boolean);
  if (selected.length !== 2 || selected.some((part) => part.kind === "hardware")) return;
  connectionPartIds = selected.map((part) => part.id);
  connectionModal.hidden = false;
  byId("connection-inset").focus();
  byId("connection-inset").select();
}

function closeConnectionModal() {
  connectionModal.hidden = true;
  connectionPartIds = [];
}

function openRenameAssemblyModal(key, currentName) {
  renamedAssemblyKey = key;
  renameAssemblyModal.hidden = false;
  byId("assembly-name").value = currentName;
  byId("assembly-name").focus();
  byId("assembly-name").select();
}

function closeRenameAssemblyModal() {
  renameAssemblyModal.hidden = true;
  renamedAssemblyKey = null;
}

function openSaveProjectModal() {
  clearTimeout(toastTimer);
  byId("toast").hidden = true;
  byId("project-name").value = currentProjectName;
  byId("save-project-message").hidden = true;
  byId("save-project-message").textContent = "";
  saveProjectModal.hidden = false;
  byId("project-name").focus();
  byId("project-name").select();
}

function closeSaveProjectModal() {
  saveProjectModal.hidden = true;
}

byId("open-add-part").addEventListener("click", openAddPartModal);
byId("save-project").addEventListener("click", openSaveProjectModal);
byId("close-save-project").addEventListener("click", closeSaveProjectModal);
byId("cancel-save-project").addEventListener("click", closeSaveProjectModal);
saveProjectModal.addEventListener("pointerdown", (event) => {
  if (event.target === saveProjectModal) closeSaveProjectModal();
});
saveProjectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = byId("confirm-save-project");
  const message = byId("save-project-message");
  message.hidden = true;
  message.textContent = "";
  submit.disabled = true;
  try {
    const response = await fetch(currentProjectId ? `${PROJECT_API}/${currentProjectId}` : PROJECT_API, {
      method: currentProjectId ? "PUT" : "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: byId("project-name").value.trim(), data: workspaceData() }),
    });
    if (response.status === 401) {
      message.textContent = "Войдите в кабинет компании, чтобы сохранить проект.";
      message.hidden = false;
      return;
    }
    if (!response.ok) throw new Error(`save_failed_${response.status}`);
    const project = await response.json();
    currentProjectId = project.id;
    currentProjectName = project.name;
    localWorkspaceKey = `${STORAGE_KEY}-project-${project.id}`;
    window.history.replaceState({}, "", `${location.pathname}?project=${project.id}`);
    byId("save-project").classList.add("saved");
    byId("save-project").textContent = "Сохранено";
    byId("save-project").title = project.name;
    closeSaveProjectModal();
    showToast(`Проект «${project.name}» сохранён`);
  } catch {
    message.textContent = "Не удалось сохранить проект. Проверьте подключение к серверу и попробуйте ещё раз.";
    message.hidden = false;
  } finally {
    submit.disabled = false;
  }
});
byId("close-add-part").addEventListener("click", closeAddPartModal);
byId("cancel-add-part").addEventListener("click", closeAddPartModal);
addPartModal.addEventListener("pointerdown", (event) => {
  if (event.target === addPartModal) closeAddPartModal();
});
byId("open-hardware").addEventListener("click", openHardwareModal);
byId("close-hardware").addEventListener("click", closeHardwareModal);
byId("cancel-hardware").addEventListener("click", closeHardwareModal);
hardwareModal.addEventListener("pointerdown", (event) => {
  if (event.target === hardwareModal) closeHardwareModal();
});
byId("open-leg-config").addEventListener("click", openLegsModal);
byId("close-legs").addEventListener("click", closeLegsModal);
byId("cancel-legs").addEventListener("click", closeLegsModal);
legsModal.addEventListener("pointerdown", (event) => {
  if (event.target === legsModal) closeLegsModal();
});
legsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const insetMm = Number(byId("legs-inset").value);
  if (!Number.isFinite(insetMm) || insetMm < 0) {
    showToast("Введите корректный отступ");
    return;
  }
  const legs = history.commit("Разместить ножки", () => model.placeBottomLegs(legsBottomId, insetMm));
  if (legs === false) {
    showToast("Для такого отступа на дне недостаточно места");
    return;
  }
  selectedIds.clear();
  legs.forEach((leg) => selectedIds.add(leg.id));
  closeLegsModal();
  render();
  showToast("Четыре ножки размещены и закреплены");
});
byId("connect-parts").addEventListener("click", () => {
  const partIds = [...selectedIds];
  const connection = model.getConnectionBetween(partIds);
  if (!connection) {
    openConnectionModal();
    return;
  }
  history.commit("Разъединить детали", () => model.disconnectParts(partIds));
  selectedConnectionId = null;
  selectedConnectionPointIndex = null;
  render();
  showToast("Конфирматы удалены, детали разъединены");
});
byId("close-connection").addEventListener("click", closeConnectionModal);
byId("cancel-connection").addEventListener("click", closeConnectionModal);
connectionModal.addEventListener("pointerdown", (event) => {
  if (event.target === connectionModal) closeConnectionModal();
});
connectionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const insetMm = Number(byId("connection-inset").value);
  if (!Number.isFinite(insetMm) || insetMm < 0) {
    showToast("Введите корректный отступ");
    return;
  }
  const connection = history.commit(
    "Соединить детали конфирматами",
    () => model.connectParts(connectionPartIds, "confirmat", insetMm),
  );
  if (connection === false) {
    showToast("Детали должны соприкасаться и ещё не быть соединены");
    return;
  }
  closeConnectionModal();
  selectedConnectionId = connection.id;
  selectedConnectionPointIndex = 0;
  render();
  const confirmatCount = getConfirmatPlacement(model, connection)?.points.length ?? 0;
  showToast(confirmatCount === 1 ? "Добавлен один конфирмат по центру" : "Добавлены два конфирмата");
});
byId("add-leg").addEventListener("click", () => {
  const created = history.commit("Добавить ножку", () => model.addLeg());
  if (created?.id) {
    selectedIds.clear();
    selectedIds.add(created.id);
    closeHardwareModal();
    render();
  }
});
addPartForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const lengthMm = Number(byId("part-length").value);
  const widthMm = Number(byId("part-width").value);
  if (!Number.isFinite(lengthMm) || !Number.isFinite(widthMm) || lengthMm <= 0 || widthMm <= 0) {
    showToast("Введите положительные размеры детали");
    return;
  }
  const material = byId("part-material").value;
  const partType = byId("new-part-type").value;
  const created = history.commit("Добавить деталь", () => model.addCustomPart({
    material,
    lengthMm,
    widthMm,
    partType,
  }));
  if (created?.id) {
    selectedIds.clear();
    selectedIds.add(created.id);
    closeAddPartModal();
    render();
  }
});
byId("new-part-type").addEventListener("change", (event) => {
  byId("new-part-length-label").textContent = event.target.value === "side" ? "Высота" : "Длина";
});
byId("part-material").addEventListener("change", (event) => {
  const isHdf = event.target.value === "hdf-4";
  const thicknessMm = isHdf ? 4 : 16;
  byId("new-part-type-field").hidden = isHdf;
  byId("part-material-note").textContent = `Толщина детали определяется материалом: ${thicknessMm} мм.`;
});

const fieldMap = {
  "part-name": "name",
  "part-type": "partType",
  "size-x": "sizeX",
  "size-y": "sizeY",
  "size-z": "sizeZ",
  "pos-x": "xMm",
  "pos-y": "yMm",
  "pos-z": "zMm",
};

Object.entries(fieldMap).forEach(([inputId, property]) => {
  byId(inputId).addEventListener("change", (event) => {
    if (selectedIds.size !== 1) return;
    const id = [...selectedIds][0];
    const isText = property === "name" || property === "partType";
    const value = isText ? event.target.value : Number(event.target.value);
    if (!isText && !Number.isFinite(value)) {
      showToast("Введите корректное число");
      return render();
    }
    const isGeometry = ["sizeX", "sizeY", "sizeZ", "xMm", "yMm", "zMm"].includes(property);
    const result = history.commit("Изменить деталь", () => (
      isGeometry
        ? model.movePartConstrained(id, { [property]: value })
        : model.updatePart(id, { [property]: value })
    ));
    if (result === false) {
      showToast("Детали не могут пересекаться");
      render();
    }
  });
});

document.querySelectorAll("[data-rotate-axis]").forEach((button) => {
  button.addEventListener("click", () => {
    if (selectedIds.size !== 1) return;
    const id = [...selectedIds][0];
    const part = model.getPart(id);
    const axis = button.dataset.rotateAxis;
    const hasFixedLegs = model.parts.some((item) => item.lockedTo === part.id);
    if (hasFixedLegs && axis !== "y") {
      showToast("Дно с закреплёнными ножками можно поворачивать только на плоскости");
      return;
    }
    const key = `rotation${axis.toUpperCase()}`;
    const result = history.commit(
      "Повернуть деталь",
      () => model.movePartConstrained(id, { [key]: part[key] + 90 }),
    );
    if (result === false) showToast("Поворот приведёт к пересечению деталей");
  });
});

byId("undo").addEventListener("click", () => history.undo());
byId("redo").addEventListener("click", () => history.redo());
const rulerSettingsPanel = byId("ruler-settings");
const rulerSettingsToggle = byId("ruler-settings-toggle");
byId("ruler-surface-snap").checked = rulerSettings.snapToSurfaces;
byId("ruler-grid-snap").checked = rulerSettings.snapToGrid;
byId("ruler-axis-lock").checked = rulerSettings.axisLock;

function closeRulerSettings() {
  rulerSettingsPanel.hidden = true;
  rulerSettingsToggle.setAttribute("aria-expanded", "false");
}

rulerSettingsToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = rulerSettingsPanel.hidden;
  rulerSettingsPanel.hidden = !open;
  rulerSettingsToggle.setAttribute("aria-expanded", String(open));
});
rulerSettingsPanel.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", closeRulerSettings);
[
  ["ruler-surface-snap", "snapToSurfaces"],
  ["ruler-grid-snap", "snapToGrid"],
  ["ruler-axis-lock", "axisLock"],
].forEach(([inputId, setting]) => {
  byId(inputId).addEventListener("change", (event) => {
    rulerSettings[setting] = event.currentTarget.checked;
    scene.setRulerSettings(rulerSettings);
    saveWorkspace();
  });
});

function disableRuler(message = "Линейка выключена") {
  rulerActive = false;
  measurementPoints = [];
  scene.setMeasurement([]);
  scene.setControlsEnabled(true);
  scene.canvas.style.cursor = "default";
  byId("ruler").classList.remove("active");
  if (message) showToast(message);
}

byId("ruler").addEventListener("click", () => {
  if (rulerActive) {
    disableRuler();
    return;
  }
  rulerActive = true;
  scene.setControlsEnabled(!rulerActive);
  scene.canvas.style.cursor = "crosshair";
  byId("ruler").classList.add("active");
  showToast("Укажите две точки для измерения");
});
byId("duplicate").addEventListener("click", () => {
  const copies = history.commit("Дублировать детали", () => model.duplicateParts([...selectedIds]));
  if (Array.isArray(copies)) {
    selectedIds.clear();
    copies.forEach((part) => selectedIds.add(part.id));
    render();
  }
});
byId("delete").addEventListener("click", () => {
  if (selectedConnectionId) {
    const connectionId = selectedConnectionId;
    history.commit("Удалить конфирматы", () => model.deleteConnection(connectionId));
    selectedConnectionId = null;
    selectedConnectionPointIndex = null;
    selectedIds.clear();
    render();
    showToast("Конфирматы удалены, детали разъединены");
    return;
  }
  if (!selectedIds.size) return;
  history.commit("Удалить детали", () => model.deleteParts([...selectedIds]));
  selectedIds.clear();
  render();
});
byId("clear-selection").addEventListener("click", clearSelectionIfAllowed);
byId("clear-multi-selection").addEventListener("click", clearSelectionIfAllowed);
byId("pin-selection").addEventListener("change", (event) => {
  selectionPinned = event.currentTarget.checked;
  saveWorkspace();
  showToast(selectionPinned ? "Выделение закреплено" : "Закрепление снято");
});
byId("show-all-dimensions").addEventListener("change", (event) => {
  showAllDimensions = event.currentTarget.checked;
  scene.setShowAllPartDimensions(showAllDimensions);
  saveWorkspace();
  showToast(showAllDimensions ? "Размеры всех деталей показаны" : "Показаны размеры выбранной детали");
});
byId("close-rename-assembly").addEventListener("click", closeRenameAssemblyModal);
byId("cancel-rename-assembly").addEventListener("click", closeRenameAssemblyModal);
renameAssemblyModal.addEventListener("pointerdown", (event) => {
  if (event.target === renameAssemblyModal) closeRenameAssemblyModal();
});
renameAssemblyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextName = byId("assembly-name").value.trim();
  if (!renamedAssemblyKey || !nextName) return;
  assemblyNames[renamedAssemblyKey] = nextName.slice(0, 80);
  closeRenameAssemblyModal();
  updateScenePartsList();
  saveWorkspace();
  showToast("Сборка переименована");
});
byId("scene-parts-list").addEventListener("click", (event) => {
  const rename = event.target.closest("[data-rename-assembly]");
  if (rename) {
    const currentName = assemblyNames[rename.dataset.renameAssembly] || rename.dataset.defaultName;
    openRenameAssemblyModal(rename.dataset.renameAssembly, currentName);
    return;
  }
  const assembly = event.target.closest("[data-assembly-ids]");
  if (assembly) {
    const ids = assembly.dataset.assemblyIds.split(",").filter(Boolean);
    const alreadySelected = ids.every((id) => selectedIds.has(id));
    if (selectionPinned && !alreadySelected) {
      showToast("Выделение закреплено");
      return;
    }
    if (!selectionPinned) selectPartIds(ids, event.ctrlKey || event.metaKey);
    return;
  }
  const button = event.target.closest("[data-part-id]");
  if (!button) return;
  const id = button.dataset.partId;
  if (selectionPinned && !selectedIds.has(id)) {
    showToast("Выделение закреплено");
    return;
  }
  if (selectionPinned) return;
  select(id, event.ctrlKey || event.metaKey);
});
byId("view-top").addEventListener("click", () => {
  scene.setView("top");
  byId("view-top").classList.add("active");
  byId("view-3d").classList.remove("active");
  saveWorkspace();
});
byId("view-3d").addEventListener("click", () => {
  scene.setView("3d");
  byId("view-3d").classList.add("active");
  byId("view-top").classList.remove("active");
  saveWorkspace();
});

scene.canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (rulerActive) {
    let point = scene.measurePoint(event, rulerSettings);
    if (!point) return;
    if (measurementPoints.length >= 2) measurementPoints = [];
    if (event.shiftKey && rulerSettings.axisLock && measurementPoints.length === 1) {
      point = constrainMeasurementPoint(measurementPoints[0], point);
    }
    measurementPoints.push(point);
    scene.setMeasurement(measurementPoints);
    suppressNextCanvasClick = true;
    if (measurementPoints.length === 1) showToast("Выберите вторую точку");
    return;
  }
  let picked = scene.pick(event);
  if (selectionPinned) {
    const sameConnection = picked?.type === "connection" && picked.id === selectedConnectionId;
    const pinnedPart = selectedConnectionId ? null : scene.pickSelectedPart(event, selectedIds);
    if (pinnedPart) picked = pinnedPart;
    if (!sameConnection && !pinnedPart) {
      showToast("Выделение закреплено");
      return;
    }
  }
  suppressNextCanvasClick = Boolean(picked);
  if (!picked) return;
  if (picked.type === "connection") {
    selectConnection(picked.id, picked.pointIndex);
    if (event.detail >= 2) {
      drag = {
        type: "confirmat",
        id: picked.id,
        pointIndex: picked.pointIndex,
        before: model.toJSON(),
      };
      scene.setControlsEnabled(false);
      scene.canvas.setPointerCapture?.(event.pointerId);
      showToast("Перемещайте конфирмат вдоль торца");
    }
    return;
  }
  const part = model.getPart(picked.id);
  if (!part) return;
  if (event.ctrlKey && !selectionPinned) {
    select(part.id, true);
    return;
  }
  if (!selectionPinned && (!selectedIds.has(part.id) || selectedIds.size > 1)) select(part.id);
  if (part.lockedTo) {
    showToast("Ножки закреплены ко дну и перемещаются вместе с ним");
    return;
  }
  const point = scene.groundPoint(event, part.yMm);
  if (!point) return;
  drag = {
    type: event.shiftKey ? "vertical" : "horizontal",
    id: part.id,
    before: model.toJSON(),
    offsetX: point.xMm - part.xMm,
    offsetZ: point.zMm - part.zMm,
    startClientY: event.clientY,
    startY: part.yMm,
  };
  scene.setControlsEnabled(false);
  scene.canvas.setPointerCapture?.(event.pointerId);
});

scene.canvas.addEventListener("dblclick", (event) => {
  if (rulerActive || event.button !== 0) return;
  const picked = scene.pick(event);
  if (selectionPinned && (!picked || picked.type !== "part" || !selectedIds.has(picked.id))) {
    showToast("Выделение закреплено");
    return;
  }
  if (picked?.type === "connection") return;
  const part = picked ? model.getPart(picked.id) : null;
  if (!part) {
    select(null);
    return;
  }
  if (part.kind === "hardware") return;
  select(part.id);
  scene.setOrientationEditor(part.id);
  showToast("Выберите лицевую сторону и направление вперёд");
});

scene.canvas.addEventListener("partorientationchange", (event) => {
  const { id, faceSide, frontDirection } = event.detail ?? {};
  const part = model.getPart(id);
  if (!part || part.kind === "hardware") return;
  const changes = {};
  if (Object.hasOwn(event.detail ?? {}, "faceSide")) changes.faceSide = faceSide;
  if (frontDirection) changes.frontDirection = frontDirection;
  history.commit("Настроить ориентацию детали", () => model.updatePart(id, changes));
  scene.setOrientationEditor(id);
});

scene.canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  if (drag.type === "confirmat") {
    const connection = model.getConnection(drag.id);
    const valueMm = connection ? scene.confirmatDragValue(event, connection) : null;
    if (valueMm === null) return;
    const positionMm = model.moveConfirmat(drag.id, drag.pointIndex, valueMm);
    scene.syncTransforms(model);
    const viewport = byId("viewport").getBoundingClientRect();
    const badge = byId("cursor-badge");
    badge.textContent = positionMm === false ? "Нельзя переместить" : `${positionMm} мм`;
    badge.style.left = `${event.clientX - viewport.left + 14}px`;
    badge.style.top = `${event.clientY - viewport.top + 14}px`;
    badge.hidden = false;
    return;
  }
  const part = model.getPart(drag.id);
  let result;
  if (drag.type === "vertical") {
    result = model.movePartConstrained(part.id, {
      yMm: drag.startY + Math.round(drag.startClientY - event.clientY),
    });
  } else {
    const point = scene.groundPoint(event, part.yMm);
    if (!point) return;
    result = model.movePartConstrained(part.id, {
      xMm: point.xMm - drag.offsetX,
      zMm: point.zMm - drag.offsetZ,
    });
  }
  byId("status-x").textContent = part.xMm;
  byId("status-y").textContent = part.yMm;
  byId("status-z").textContent = part.zMm;
  scene.syncTransforms(model);
  const viewport = byId("viewport").getBoundingClientRect();
  const badge = byId("cursor-badge");
  badge.textContent = result === false
    ? "Столкновение"
    : result?.snappedTo
      ? "Прикреплено к детали"
      : drag.type === "vertical" ? `Y: ${part.yMm} мм` : "1 мм";
  badge.style.left = `${event.clientX - viewport.left + 14}px`;
  badge.style.top = `${event.clientY - viewport.top + 14}px`;
  badge.hidden = false;
});

window.addEventListener("pointerup", () => {
  if (!drag) return;
  const after = model.toJSON();
  if (JSON.stringify(drag.before) !== JSON.stringify(after)) {
    history.push(
      drag.type === "confirmat" ? "Переместить конфирмат" : "Переместить деталь",
      drag.before,
      after,
    );
  }
  drag = null;
  scene.setControlsEnabled(true);
  byId("cursor-badge").hidden = true;
  render();
});

scene.canvas.addEventListener("click", (event) => {
  if (suppressNextCanvasClick) {
    suppressNextCanvasClick = false;
    return;
  }
  if (drag || scene.pick(event)) return;
});
scene.canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
scene.canvas.addEventListener("ruleraction", (event) => {
  if (event.detail?.action === "remove") {
    disableRuler("Линейка убрана");
    return;
  }
  if (event.detail?.action !== "setting" || !(event.detail.setting in rulerSettings)) return;
  rulerSettings[event.detail.setting] = Boolean(event.detail.value);
  const inputIds = {
    snapToSurfaces: "ruler-surface-snap",
    snapToGrid: "ruler-grid-snap",
    axisLock: "ruler-axis-lock",
  };
  byId(inputIds[event.detail.setting]).checked = rulerSettings[event.detail.setting];
  scene.setRulerSettings(rulerSettings);
  saveWorkspace();
});

window.addEventListener("keydown", (event) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  const key = cameraCodeMap[event.code];
  if (!key) return;
  cameraKeys.add(key);
  event.preventDefault();
});

window.addEventListener("keyup", (event) => {
  const key = cameraCodeMap[event.code];
  if (!key) return;
  cameraKeys.delete(key);
  if (!cameraKeys.size) saveWorkspace();
});

window.addEventListener("blur", () => {
  cameraKeys.clear();
  saveWorkspace();
});

function updateKeyboardCamera(now) {
  const deltaSeconds = Math.min(0.05, Math.max(0, (now - previousCameraFrame) / 1000));
  previousCameraFrame = now;
  const horizontal = (cameraKeys.has("d") ? 1 : 0) - (cameraKeys.has("a") ? 1 : 0);
  const vertical = (cameraKeys.has("w") ? 1 : 0) - (cameraKeys.has("s") ? 1 : 0);
  scene.panCameraScreen(horizontal, vertical, deltaSeconds);
  requestAnimationFrame(updateKeyboardCamera);
}
requestAnimationFrame(updateKeyboardCamera);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!rulerSettingsPanel.hidden) {
      closeRulerSettings();
      return;
    }
    if (rulerActive) {
      disableRuler("");
      return;
    }
    if (!addPartModal.hidden) {
      closeAddPartModal();
      return;
    }
    if (!hardwareModal.hidden) {
      closeHardwareModal();
      return;
    }
    if (!legsModal.hidden) {
      closeLegsModal();
      return;
    }
    if (!connectionModal.hidden) {
      closeConnectionModal();
      return;
    }
    if (!renameAssemblyModal.hidden) {
      closeRenameAssemblyModal();
      return;
    }
    if (!saveProjectModal.hidden) {
      closeSaveProjectModal();
      return;
    }
  }
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? history.redo() : history.undo();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    history.redo();
  } else if (event.key === "Delete") {
    byId("delete").click();
  } else if (event.key === "Escape") {
    clearSelectionIfAllowed();
  }
});

render();

async function loadServerProject() {
  if (!currentProjectId) return;
  try {
    const response = await fetch(`${PROJECT_API}/${currentProjectId}`, { credentials: "include" });
    if (!response.ok) throw new Error("load_failed");
    const project = await response.json();
    const data = project.data;
    if (!data?.model) throw new Error("invalid_project");
    model.restore(data.model);
    selectedIds.clear();
    (data.selectedIds ?? []).forEach((id) => selectedIds.add(id));
    selectedConnectionId = data.selectedConnectionId ?? null;
    selectedConnectionPointIndex = data.selectedConnectionPointIndex ?? null;
    selectionPinned = Boolean(data.selectionPinned);
    showAllDimensions = Boolean(data.showAllDimensions);
    Object.keys(assemblyNames).forEach((key) => delete assemblyNames[key]);
    Object.assign(assemblyNames, data.assemblyNames ?? {});
    Object.assign(rulerSettings, data.rulerSettings ?? {});
    history.undoStack = Array.isArray(data.undoStack) ? data.undoStack : [];
    history.redoStack = Array.isArray(data.redoStack) ? data.redoStack : [];
    if (data.view) scene.restoreViewState(data.view);
    scene.setShowAllPartDimensions(showAllDimensions);
    scene.setRulerSettings(rulerSettings);
    currentProjectName = project.name;
    byId("save-project").classList.add("saved");
    byId("save-project").textContent = "Сохранено";
    byId("save-project").title = project.name;
    document.title = `${project.name} — Редактор мебели`;
    render();
    showToast(`Открыт проект «${project.name}»`);
  } catch {
    showToast("Не удалось открыть проект из кабинета");
  }
  queueServerAutosave();
}

function queueServerAutosave() {
  if (!model.parts.length) return;
  clearTimeout(serverAutosaveTimer);
  serverAutosaveTimer = setTimeout(async () => {
    try {
      const response = await fetch(`${PROJECT_API}/autosave`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProjectId,
          name: currentProjectName,
          data: workspaceData(),
        }),
      });
      if (!response.ok) return;
      const project = await response.json();
      currentProjectId = project.id;
      currentProjectName = project.name;
      localWorkspaceKey = `${STORAGE_KEY}-project-${project.id}`;
      window.history.replaceState({}, "", `${location.pathname}?project=${project.id}`);
      byId("save-project").classList.add("saved");
      byId("save-project").textContent = "Автосохранено";
      byId("save-project").title = project.name;
    } catch {
      // The independent local draft remains available if the server is offline.
    }
  }, 2000);
}

window.addEventListener("beforeunload", () => {
  if (!model.parts.length) return;
  const payload = JSON.stringify({
    projectId: currentProjectId,
    name: currentProjectName,
    data: workspaceData(),
  });
  navigator.sendBeacon(`${PROJECT_API}/autosave`, new Blob([payload], { type: "application/json" }));
});

loadServerProject();
