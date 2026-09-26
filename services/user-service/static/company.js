const logout = document.querySelector("#company-logout");

logout?.addEventListener("click", async () => {
  logout.disabled = true;
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.replace("/");
});

document.querySelector("#mobile-menu")?.addEventListener("click", () => {
  document.body.classList.toggle("menu-open");
});

const projectModal = document.querySelector("#project-modal");
document.querySelector("#open-project")?.addEventListener("click", () => {
  projectModal.hidden = false;
  document.querySelector("#project-name").focus();
});
document.querySelector("#cancel-project")?.addEventListener("click", () => { projectModal.hidden = true; });
projectModal?.addEventListener("pointerdown", (event) => { if (event.target === projectModal) projectModal.hidden = true; });
document.querySelector("#project-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.querySelector("#project-error");
  error.hidden = true;
  try {
    const response = await fetch("/api/projects", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: document.querySelector("#project-name").value.trim() }),
    });
    if (!response.ok) throw new Error();
    const project = await response.json();
    window.location.href = `/company/projects/${project.id}`;
  } catch {
    error.textContent = "Не удалось создать проект. Попробуйте ещё раз.";
    error.hidden = false;
  }
});

const roomModal = document.querySelector("#room-modal");
document.querySelector("#open-room")?.addEventListener("click", () => {
  roomModal.hidden = false;
  document.querySelector("#room-name").focus();
});
document.querySelector("#cancel-room")?.addEventListener("click", () => { roomModal.hidden = true; });
roomModal?.addEventListener("pointerdown", (event) => { if (event.target === roomModal) roomModal.hidden = true; });
document.querySelector("#room-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#room-error");
  error.hidden = true;
  try {
    const response = await fetch(`/api/projects/${form.dataset.projectId}/rooms`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: document.querySelector("#room-name").value.trim() }),
    });
    if (!response.ok) throw new Error();
    const room = await response.json();
    window.location.href = `http://127.0.0.1:8082/constructor/?room=${room.id}`;
  } catch {
    error.textContent = "Не удалось создать помещение. Попробуйте ещё раз.";
    error.hidden = false;
  }
});

document.querySelectorAll("[data-copy-library]").forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch(
        `/api/projects/${button.dataset.projectId}/library/${button.dataset.copyLibrary}/copy`,
        { method: "POST", credentials: "same-origin" },
      );
      if (!response.ok) throw new Error();
      window.location.reload();
    } catch {
      button.disabled = false;
      window.alert("Не удалось добавить мебель из библиотеки.");
    }
  });
});

document.querySelector("#delete-project")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!window.confirm(`Удалить проект и все его помещения (${button.dataset.roomCount}) и мебель (${button.dataset.furnitureCount})?`)) return;
  const response = await fetch(`/api/projects/${button.dataset.projectId}`, {
    method: "DELETE", credentials: "same-origin",
  });
  if (response.ok) window.location.href = "/company";
  else window.alert("Не удалось удалить проект.");
});
