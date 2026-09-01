const dialog = document.querySelector("#auth-dialog");
const authForms = document.querySelector("#auth-forms");
const authenticated = document.querySelector("#authenticated");
const message = document.querySelector("#form-message");
const tabs = [...document.querySelectorAll("[data-tab]")];
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");

function showTab(mode) {
  const register = mode === "register";
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === mode));
  loginForm.hidden = register;
  registerForm.hidden = !register;
  document.querySelector("#auth-title").textContent = register ? "Создайте профиль" : "Войдите в профиль";
  document.querySelector("#form-subtitle").textContent = register ? "Выберите личный аккаунт или профиль компании." : "Используйте email и пароль, указанные при регистрации.";
  message.textContent = "";
}

async function loadSession() {
  const response = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!response.ok) return false;
  const { user } = await response.json();
  authForms.hidden = true;
  authenticated.hidden = false;
  document.querySelector("#welcome-name").textContent = `${user.firstname}, профиль готов.`;
  document.querySelector("#welcome-email").textContent = `${user.email} · ${user.category === "company" ? "Компания" : "Пользователь"}`;
  return true;
}

document.querySelectorAll("[data-open-auth]").forEach((button) => button.addEventListener("click", async () => {
  authForms.hidden = false;
  authenticated.hidden = true;
  showTab(button.dataset.mode || "login");
  if (button.dataset.role) {
    document.querySelector(`.roles [data-role="${button.dataset.role}"]`).click();
  }
  await loadSession();
  dialog.showModal();
}));

document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
tabs.forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

document.querySelectorAll(".roles [data-role]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".roles [data-role]").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelector("#register-role").value = button.dataset.role;
}));

document.querySelectorAll(".password-toggle").forEach((button) => button.addEventListener("click", () => {
  const input = button.parentElement.querySelector("input");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  button.setAttribute("aria-pressed", String(!visible));
  button.setAttribute("aria-label", visible ? "Показать пароль" : "Скрыть пароль");
  button.textContent = visible ? "◉" : "◌";
  input.focus({ preventScroll: true });
}));

async function submit(form, endpoint) {
  if (!form.reportValidity()) return;
  const submitButton = form.querySelector("[type=submit]");
  submitButton.disabled = true;
  message.textContent = "Проверяем данные…";
  message.className = "form-message";
  try {
    const body = Object.fromEntries(new FormData(form));
    if (form === loginForm) body.remember = Boolean(form.elements.remember?.checked);
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Не удалось выполнить запрос.");
    if (endpoint.endsWith("register")) {
      message.textContent = "Профиль создан. Теперь войдите.";
      message.classList.add("success");
      const email = body.email;
      showTab("login");
      loginForm.email.value = email;
    } else {
      const requestedReturn = new URLSearchParams(window.location.search).get("returnTo");
      let destination = { company: "/company", admin: "/admin", user: "/user" }[data.user?.category] || "/user";
      if (data.user?.category === "company" && requestedReturn) {
        try {
          const returnUrl = new URL(requestedReturn);
          if (["http://127.0.0.1:5173", "http://127.0.0.1:5174"].includes(returnUrl.origin)) {
            destination = returnUrl.href;
          }
        } catch {
          // Invalid return addresses are ignored.
        }
      }
      window.location.assign(destination);
      return;
    }
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    submitButton.disabled = false;
  }
}

loginForm.addEventListener("submit", (event) => { event.preventDefault(); submit(loginForm, "/api/auth/login"); });
registerForm.addEventListener("submit", (event) => { event.preventDefault(); submit(registerForm, "/api/auth/register"); });
if (new URLSearchParams(window.location.search).get("auth") === "company") {
  document.querySelector(".signin[data-open-auth]")?.click();
  message.textContent = "Войдите в профиль компании — редактор и конструктор доступны только мебельщикам.";
  message.classList.add("error");
}
document.querySelector("#logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  authenticated.hidden = true; authForms.hidden = false; showTab("login");
});
