import { defineConfig } from "vite";

function companyAccessGuard(toolPath, toolOrigin) {
  return {
    name: "company-access-guard",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split("?")[0];
        const requestsPage = request.method === "GET"
          && request.headers.accept?.includes("text/html")
          && (pathname === toolPath || pathname === `${toolPath}index.html`);
        if (!requestsPage) return next();
        try {
          const authResponse = await fetch("http://127.0.0.1:8080/api/auth/me", {
            headers: { cookie: request.headers.cookie ?? "" },
          });
          const auth = authResponse.ok ? await authResponse.json() : null;
          if (auth?.user?.category === "company") return next();
        } catch {
          // Fail closed when the user service cannot verify the session.
        }
        response.statusCode = 302;
        const returnTo = encodeURIComponent(`${toolOrigin}${request.url ?? toolPath}`);
        response.setHeader("Location", `http://127.0.0.1:8080/?auth=company&returnTo=${returnTo}`);
        response.end();
      });
    },
  };
}

export default defineConfig({
  base: "/editor/",
  plugins: [companyAccessGuard("/editor/", "http://127.0.0.1:5174")],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
});
