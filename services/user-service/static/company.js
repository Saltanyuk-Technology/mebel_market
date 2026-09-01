const logout = document.querySelector("#company-logout");

logout?.addEventListener("click", async () => {
  logout.disabled = true;
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  window.location.replace("/");
});

document.querySelector("#mobile-menu")?.addEventListener("click", () => {
  document.body.classList.toggle("menu-open");
});
