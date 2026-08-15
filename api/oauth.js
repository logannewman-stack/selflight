// Signing into a service, so connecting one costs a click instead of a trip to
// find an API key.
//
// Two halves of one flow, which is why they're one file:
//
//   POST /api/oauth?action=start      (with the Polstar session token)
//        → { url }, and a signed cookie holding who asked
//   GET  /api/oauth?action=callback   (the provider sends the browser here)
//        → exchanges the code, stores the token, redirects back to the app
//
// The awkward part of OAuth in a single-page app is that the return leg is a
// browser navigation, so it carries no Authorization header and cannot say who
// it belongs to. Putting the user id in the URL would let anyone attach a
// connection to anyone's account. So `start` — which *is* authenticated —
// writes it into a short-lived HttpOnly cookie signed with the service-role
// key, and the callback trusts nothing else.
//
// The token that comes back never returns to a browser. It goes into
// connector_secrets, which no signed-in user can read.

import crypto from "node:crypto";
import { db, hasSupabase, userFromRequest } from "./_supabase.js";
import {
  authorizeUrl,
  clientIdEnv,
  clientSecretEnv,
  isConfigured,
  missingFor,
  providerById
} from "./_catalogue.js";

const COOKIE = "sl_oauth";
const TEN_MINUTES = 600;

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const action = url.searchParams.get("action");

  if (!hasSupabase) return json(res, 501, { error: "No Supabase project is configured." });

  if (action === "start") return start(req, res);
  if (action === "callback") return callback(req, res, url);
  return json(res, 404, { error: "Unknown action." });
}

/* --------------------------------- start --------------------------------- */

async function start(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  const user = await userFromRequest(req);
  if (!user) return json(res, 401, { error: "Sign in first." });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "Could not parse the request body." });
  }

  const provider = providerById(String(body.provider || ""));
  if (!provider) return json(res, 404, { error: "No such service." });

  if (!isConfigured(provider)) {
    const missing = missingFor(provider);
    return json(res, 503, {
      error: `${provider.name} isn't set up on this deployment yet.`,
      missing,
      register: provider.register
    });
  }

  // Proves the browser that comes back is the one that left. Without it, anyone
  // could feed us a code obtained elsewhere.
  const nonce = crypto.randomBytes(24).toString("base64url");
  const state = sign({ p: provider.id, u: user.id, n: nonce, t: Date.now() });

  const target = new URL(authorizeUrl(provider));
  target.searchParams.set("client_id", process.env[clientIdEnv(provider.id)]);
  target.searchParams.set("redirect_uri", redirectUri(req));
  target.searchParams.set("response_type", "code");
  target.searchParams.set("state", nonce);
  if (provider.scopes?.length) target.searchParams.set("scope", provider.scopes.join(" "));
  for (const [key, value] of Object.entries(provider.extraAuthParams || {})) {
    target.searchParams.set(key, value);
  }

  res.setHeader("Set-Cookie", cookie(state, TEN_MINUTES));
  return json(res, 200, { url: target.toString() });
}

/* -------------------------------- callback ------------------------------- */

async function callback(req, res, url) {
  const back = (params) => {
    const to = new URL(appOrigin(req));
    for (const [key, value] of Object.entries(params)) to.searchParams.set(key, value);
    res.writeHead(302, { Location: to.toString(), "Set-Cookie": cookie("", 0) });
    res.end();
  };

  // The person pressed cancel on the provider's screen. Not an error.
  const denied = url.searchParams.get("error");
  if (denied) return back({ connectError: describe(denied) });

  const code = url.searchParams.get("code");
  const returned = url.searchParams.get("state");
  if (!code || !returned) return back({ connectError: "That sign-in came back incomplete." });

  const claim = verify(readCookie(req, COOKIE));
  if (!claim || claim.n !== returned) {
    return back({ connectError: "That sign-in couldn't be matched to your session. Try again." });
  }
  if (Date.now() - claim.t > TEN_MINUTES * 1000) {
    return back({ connectError: "That sign-in took too long. Try again." });
  }

  const provider = providerById(claim.p);
  if (!provider || !isConfigured(provider)) {
    return back({ connectError: "That service is no longer set up here." });
  }

  let token;
  try {
    token = await exchange(provider, code, redirectUri(req));
  } catch (err) {
    console.error(`[api/oauth] ${provider.id} exchange: ${err.message}`);
    return back({ connectError: `${provider.name} wouldn't complete the sign-in.` });
  }

  const account = await whoIs(provider, token);

  const stored = await store(claim.u, provider, token, account);
  if (stored) {
    console.error(`[api/oauth] storing ${provider.id}: ${stored.message}`);
    return back({ connectError: `Couldn't save the ${provider.name} connection.` });
  }

  return back({ connected: provider.id });
}

/* -------------------------------- exchange ------------------------------- */

async function exchange(provider, code, redirect) {
  const id = process.env[clientIdEnv(provider.id)];
  const secret = process.env[clientSecretEnv(provider.id)];

  const fields = { grant_type: "authorization_code", code, redirect_uri: redirect };
  const headers = { Accept: provider.exchange.accept || "application/json" };

  // Credentials go in a Basic header or in the body depending on the provider;
  // both are in the spec and neither is optional for the ones that want it.
  if (provider.exchange.auth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  } else {
    fields.client_id = id;
    fields.client_secret = secret;
  }

  let body;
  if (provider.exchange.style === "json") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(fields);
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(fields).toString();
  }

  const res = await fetch(provider.token, { method: "POST", headers, body });
  const payload = await res.json().catch(() => null);

  if (!res.ok) throw new Error(payload?.error_description || payload?.error || `HTTP ${res.status}`);
  // GitHub answers 200 with an error in the body, which is exactly the shape of
  // mistake that turns into "connected" with nothing behind it.
  if (payload?.error) throw new Error(payload.error_description || payload.error);
  if (!payload?.access_token) throw new Error("no access token in the response");

  return {
    access: payload.access_token,
    refresh: payload.refresh_token || null,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null,
    label: provider.labelFrom ? payload[provider.labelFrom] || null : null
  };
}

// A name to show on the row. Never required — a connection with no label is
// still a working connection, so this failing must not fail the sign-in.
async function whoIs(provider, token) {
  if (token.label) return token.label;
  if (!provider.identity) return null;

  try {
    const res = await fetch(provider.identity.url, {
      headers: { Authorization: `Bearer ${token.access}`, Accept: "application/json" }
    });
    if (!res.ok) return null;
    const body = await res.json();
    return provider.identity.field.split(".").reduce((at, key) => at?.[key], body) ?? null;
  } catch {
    return null;
  }
}

/* --------------------------------- storing ------------------------------- */

async function store(userId, provider, token, account) {
  const client = db();

  // What one sign-in produces. A service with a hosted MCP server becomes a
  // single connector pointing at it; one without becomes an http connector per
  // API it exposes, all sharing the token that was just issued. Google is the
  // reason for the second shape — Gmail, Calendar, Drive and Sheets are four
  // different hosts, and a connector is pinned to exactly one.
  const rows = provider.mcp
    ? [{ name: provider.name, url: provider.mcp, kind: "mcp", base_url: null, docs: null }]
    : (provider.api || []).map((api) => ({
        name: api.name,
        // `url` is not null in the schema and means "where this points"; for an
        // http connector that is the same address the model is pinned to.
        url: api.base,
        kind: "http",
        base_url: api.base,
        docs: api.docs || null
      }));

  if (!rows.length) {
    return new Error(`${provider.name} has nothing to connect to — no MCP server and no APIs.`);
  }

  let connector;
  for (const row of rows) {
    const { data, error } = await client
      .from("connectors")
      .upsert(
        {
          user_id: userId,
          provider: provider.id,
          name: row.name,
          url: row.url,
          kind: row.kind,
          base_url: row.base_url,
          docs: row.docs,
          // Read-only. A token that can send mail as you is not something to
          // hand a model by default because you clicked "Connect".
          methods: row.kind === "http" ? ["GET", "HEAD"] : ["GET", "HEAD"],
          auth_style: "bearer",
          account,
          enabled: true,
          has_token: true
        },
        { onConflict: "user_id,provider,name" }
      )
      .select("id")
      .single();

    if (error || !data) return error || new Error("no connector row");
    connector = data;

    // The token is stored against every connector the sign-in produced, so
    // each one can be revoked on its own.
    const failed = await client.from("connector_secrets").upsert(
      {
        connector_id: data.id,
        user_id: userId,
        token: token.access,
        refresh_token: token.refresh,
        expires_at: token.expiresAt,
        updated_at: new Date().toISOString()
      },
      { onConflict: "connector_id" }
    );
    if (failed.error) return failed.error;
  }

  return connector ? null : new Error("nothing was connected");
}

/* ------------------------------ signed state ----------------------------- */

// The service-role key is server-only and long, which makes it a serviceable
// signing secret without introducing another one to configure and lose.
function secret() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function sign(claim) {
  const body = Buffer.from(JSON.stringify(claim)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(value) {
  const [body, mac] = String(value || "").split(".");
  if (!body || !mac) return null;

  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  // Constant-time, so a wrong signature can't be found one character at a time.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

/* --------------------------------- plumbing ------------------------------ */

function appOrigin(req) {
  if (process.env.SELFLIGHT_URL) return process.env.SELFLIGHT_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

// Must match the callback URL registered with the provider, character for
// character — a trailing slash is a different URL to most of them.
export function redirectUri(req) {
  return `${appOrigin(req)}/api/oauth?action=callback`;
}

function cookie(value, maxAge) {
  // Lax rather than Strict: the provider sends the browser back across sites,
  // and Strict would withhold the cookie on exactly that navigation.
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function describe(error) {
  if (error === "access_denied") return "You cancelled that sign-in.";
  return "That sign-in didn't complete.";
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

export { sign, verify };
