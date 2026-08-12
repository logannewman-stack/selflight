import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// In production Vercel runs everything in /api as a serverless function. During
// `npm run dev` there is no Vercel runtime, so this plugin mounts the same
// handler as Vite middleware — `npm run dev` alone gives you a working app.
function apiDevServer() {
  return {
    name: "selflight-api-dev",
    configureServer(server) {
      server.middlewares.use("/api/chat", async (req, res, next) => {
        if (req.method !== "POST") return next();
        try {
          const { default: handler } = await server.ssrLoadModule("/api/chat.js");
          await handler(req, res);
        } catch (err) {
          server.config.logger.error(`[api/chat] ${err?.stack || err}`);
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  // Vite only exposes VITE_-prefixed vars to the client. The API key is not one
  // of those on purpose — load it here so the dev middleware can read it.
  const env = loadEnv(mode, process.cwd(), "");
  if (!process.env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  }

  return {
    plugins: [react(), apiDevServer()],
    server: { port: 5173 }
  };
});
