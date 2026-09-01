const menuButton = document.querySelector("#mobile-menu");
menuButton?.addEventListener("click", () => document.body.classList.toggle("menu-open"));

document.querySelector("#dashboard-logout")?.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.assign("/");
});

const search = document.querySelector("#user-search");
search?.addEventListener("input", () => {
  const query = search.value.trim().toLocaleLowerCase("ru");
  document.querySelectorAll("[data-user-row]").forEach((row) => {
    row.hidden = !row.dataset.search.includes(query);
  });
});

const toast = document.querySelector("#dashboard-toast");
function showToast(text) {
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

document.querySelectorAll("[data-account-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const disabled = button.dataset.disabled !== "true";
      const response = await fetch(`/api/admin/users/${button.dataset.userId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Не удалось изменить аккаунт.");
      button.dataset.disabled = String(disabled);
      button.textContent = disabled ? "Включить" : "Отключить";
      const status = button.closest("tr").querySelector("[data-status]");
      status.textContent = disabled ? "Отключён" : "Активен";
      status.classList.toggle("disabled", disabled);
      showToast(disabled ? "Аккаунт отключён" : "Аккаунт снова активен");
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
});
