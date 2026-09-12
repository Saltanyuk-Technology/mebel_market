const logout = document.querySelector("#company-logout");

logout?.addEventListener("click", async () => {
  logout.disabled = true;
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.replace("/");
});

document.querySelector("#mobile-menu")?.addEventListener("click", () => {
  document.body.classList.toggle("menu-open");
});

const kitchenModal = document.querySelector("#kitchen-project-modal");
document.querySelector("#open-kitchen-project")?.addEventListener("click", () => {
  kitchenModal.hidden = false;
  document.querySelector("#kitchen-project-name").focus();
});
document.querySelector("#cancel-kitchen-project")?.addEventListener("click", () => { kitchenModal.hidden = true; });
kitchenModal?.addEventListener("pointerdown", (event) => { if (event.target === kitchenModal) kitchenModal.hidden = true; });
document.querySelector("#kitchen-project-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = document.querySelector("#kitchen-project-error");
  error.hidden = true;
  try {
    const response = await fetch("/api/kitchen-projects", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: document.querySelector("#kitchen-project-name").value.trim() }),
    });
    if (!response.ok) throw new Error();
    const project = await response.json();
    window.location.href = `/company/kitchen-projects/${project.id}`;
  } catch {
    error.textContent = "Не удалось создать проект. Попробуйте ещё раз.";
    error.hidden = false;
  }
});
