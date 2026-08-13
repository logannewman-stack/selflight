// The services someone can connect by signing in, rather than by finding an
// API key and pasting it.
//
// Each entry is three things: where to send someone to authorise, how to turn
// the code they come back with into a token, and the MCP endpoint that token
// then unlocks. Everything else in the OAuth route is generic — adding a
// service means adding a row here.
//
// One thing this cannot do for you: the client id and secret. Every provider
// requires the *application* to be registered with them before it can act for
// anybody, which is a five-minute job you do once (see `register` below). Until
// those two variables are set, the service simply doesn't appear — an offer to
// connect something that can't connect is worse than no offer.
//
// URLs checked August 2026. They move; `docs` is where to confirm them.

export const PROVIDERS = [
  {
    id: "github",
    name: "GitHub",
    blurb: "Repositories, issues, pull requests and code search.",
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    exchange: { style: "form", auth: "body", accept: "application/json" },
    scopes: ["repo", "read:user", "read:org"],
    mcp: "https://api.githubcopilot.com/mcp/",
    identity: { url: "https://api.github.com/user", field: "login" },
    register: "https://github.com/settings/developers",
    docs: "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps"
  },
  {
    id: "vercel",
    name: "Vercel",
    blurb: "Projects, deployments and build logs.",
    // Vercel authorises through an Integration rather than a bare OAuth app, so
    // the install page is per-integration and its slug is configuration.
    authorize: (env) => `https://vercel.com/integrations/${env.VERCEL_INTEGRATION_SLUG || ""}/new`,
    token: "https://api.vercel.com/v2/oauth/access_token",
    exchange: { style: "form", auth: "body" },
    scopes: [],
    mcp: "https://mcp.vercel.com",
    identity: { url: "https://api.vercel.com/v2/user", field: "user.username" },
    needs: ["VERCEL_INTEGRATION_SLUG"],
    register: "https://vercel.com/dashboard/integrations/console",
    docs: "https://vercel.com/docs/integrations/create-integration"
  },
  {
    id: "linear",
    name: "Linear",
    blurb: "Issues, projects and cycles.",
    authorize: "https://linear.app/oauth/authorize",
    token: "https://api.linear.app/oauth/token",
    exchange: { style: "form", auth: "body" },
    scopes: ["read", "write"],
    mcp: "https://mcp.linear.app/mcp",
    register: "https://linear.app/settings/api/applications/new",
    docs: "https://developers.linear.app/docs/oauth/authentication"
  },
  {
    id: "notion",
    name: "Notion",
    blurb: "Pages, databases and search across a workspace.",
    authorize: "https://api.notion.com/v1/oauth/authorize",
    token: "https://api.notion.com/v1/oauth/token",
    // Notion is the odd one out: JSON body, credentials in a Basic header.
    exchange: { style: "json", auth: "basic" },
    scopes: [],
    extraAuthParams: { owner: "user" },
    mcp: "https://mcp.notion.com/mcp",
    // Comes back with the token itself, so no second request to find out who.
    labelFrom: "workspace_name",
    register: "https://www.notion.so/my-integrations",
    docs: "https://developers.notion.com/docs/authorization"
  }
];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

const upper = (id) => id.replace(/-/g, "_").toUpperCase();

export function clientIdEnv(id) {
  return `${upper(id)}_CLIENT_ID`;
}

export function clientSecretEnv(id) {
  return `${upper(id)}_CLIENT_SECRET`;
}

// A provider is offerable only when everything it needs is present. Reported
// rather than assumed, so the panel can say which variable is missing instead
// of showing a button that fails after the redirect.
export function missingFor(provider, env = process.env) {
  return [
    !env[clientIdEnv(provider.id)] && clientIdEnv(provider.id),
    !env[clientSecretEnv(provider.id)] && clientSecretEnv(provider.id),
    ...(provider.needs || []).map((name) => !env[name] && name)
  ].filter(Boolean);
}

export function isConfigured(provider, env = process.env) {
  return missingFor(provider, env).length === 0;
}

export function authorizeUrl(provider, env = process.env) {
  return typeof provider.authorize === "function" ? provider.authorize(env) : provider.authorize;
}

/**
 * What the browser is allowed to know: which services this deployment can
 * actually connect, and for the rest, exactly what's missing and where to get
 * it. No secret is in any of it — an environment variable's *name* is not one,
 * and saying "GITHUB_CLIENT_SECRET isn't set" tells an attacker nothing they
 * couldn't learn by pressing the button.
 */
export function catalogue(env = process.env) {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    blurb: provider.blurb,
    mcp: provider.mcp,
    ready: isConfigured(provider, env),
    missing: missingFor(provider, env),
    register: provider.register,
    docs: provider.docs
  }));
}
