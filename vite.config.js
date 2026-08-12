import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Every route the api/ folder exposes. Vercel derives these from the filenames;
// during `npm run dev` there's no Vercel runtime, so the same handlers get
// mounted as Vite middleware and `npm run dev` alone gives you a working app.
const ROUTES = ["chat", "connectors", "capabilities"];

// Server-only secrets. Vite deliberately withholds anything without a VITE_
// prefix from the browser, which is what we want for these — but it means the
// dev middleware has to be handed them explicitly.
const SERVER_ENV = [
  "PERPLEXITY_API_KEY",
  "ANTHROPIC_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SELFLIGHT_MONTHLY_TOKEN_CAP"
];

function apiDevServer() {
  return {
    name: "selflight-api-dev",
    configureServer(server) {
      for (const route of ROUTES) {
        server.middlewares.use(`/api/${route}`, async (req, res) => {
          // Method checks belong to the handlers, same as they do on Vercel.
          try {
            const { default: handler } = await server.ssrLoadModule(`/api/${route}.js`);
            await handler(req, res);
          } catch (err) {
            server.config.logger.error(`[api/${route}] ${err?.stack || err}`);
            if (!res.headersSent) res.statusCode = 500;
            res.end();
          }
        });
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const key of SERVER_ENV) {
    if (!process.env[key] && env[key]) process.env[key] = env[key];
  }
  // The server can reuse the browser's project URL — same project, different key.
  if (!process.env.SUPABASE_URL && env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = env.VITE_SUPABASE_URL;
  }

  return {
    plugins: [react(), apiDevServer()],
    server: { port: 5173 }
  };
});
