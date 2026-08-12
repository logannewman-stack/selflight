// The same checks scripts/doctor.mjs runs, answered over HTTP so the app can
// show them on a screen. Setting this up shouldn't require a terminal.
//
// Nothing secret comes back: booleans, counts, and the provider's name. Never a
// key, never a row, never an email. The one sensitive-looking field is whether
// the public key can read private tables — and if that's true the data is
// already public, so hiding the flag would protect nobody and inform no one.

import { createClient } from "@supabase/supabase-js";
import { provider } from "./provider.js";
import { MONTHLY_TOKEN_CAP, hasSupabase } from "./_supabase.js";

const TABLES = [
  "profiles",
  "user_settings",
  "palettes",
  "chats",
  "messages",
  "connectors",
  "connector_secrets",
  "usage_events"
];

const PRIVATE_TABLES = ["chats", "messages", "user_settings", "connector_secrets"];

export default async function handler(req, res) {
  const live = /[?&]live=1/.test(req.url || "");

  const report = {
    model: await checkModel(live),
    accounts: await checkAccounts(),
    cap: MONTHLY_TOKEN_CAP
  };

  report.ready = report.model.ok && report.accounts.state !== "broken";

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(report));
}

/* --------------------------------- model --------------------------------- */

async function checkModel(live) {
  const model = provider();
  const result = { provider: model.name, keyName: model.keyName, ok: model.configured() };

  if (!result.ok || !live || model.name !== "Perplexity") return result;

  // One real, tiny call. This is the only way to tell a key that is *set* from a
  // key that *works*, and it costs a few thousandths of a cent.
  const started = Date.now();
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        max_tokens: 5,
        disable_search: true
      })
    });

    if (res.ok) {
      result.live = { ok: true, ms: Date.now() - started };
      return result;
    }

    const body = await res.json().catch(() => null);
    result.live = { ok: false, status: res.status, message: describe(res.status, body) };
  } catch (err) {
    result.live = { ok: false, message: `Couldn't reach Perplexity: ${err.message}` };
  }

  return result;
}

function describe(status, body) {
  const detail = body?.error?.message || body?.detail || "";
  if (status === 401 || status === 403) {
    return "Perplexity didn't accept that key. Check it was copied whole, with no spaces at either end.";
  }
  if (status === 402) return "The Perplexity account has no credit left. Add some and try again.";
  if (status === 429) return "Perplexity is rate limiting. Wait a minute and check again.";
  return detail || `Perplexity returned an error (${status}).`;
}

/* -------------------------------- accounts ------------------------------- */

async function checkAccounts() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  const missing = [
    !url && "VITE_SUPABASE_URL",
    !anonKey && "VITE_SUPABASE_ANON_KEY",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY"
  ].filter(Boolean);

  // No Supabase at all is a supported setup, not a broken one: Selflight runs
  // signed-out and stores everything in the browser.
  if (missing.length === 3) return { state: "off" };
  if (missing.length) return { state: "broken", missing };

  if (anonKey === serviceKey) {
    return {
      state: "broken",
      sameKey: true
    };
  }

  const ref = /https:\/\/([a-z0-9]+)\.supabase\./.exec(url)?.[1] || null;
  const mismatched = [
    projectRef(anonKey) && ref && projectRef(anonKey) !== ref && "VITE_SUPABASE_ANON_KEY",
    projectRef(serviceKey) && ref && projectRef(serviceKey) !== ref && "SUPABASE_SERVICE_ROLE_KEY"
  ].filter(Boolean);

  if (mismatched.length) return { state: "broken", mismatched, project: ref };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const found = [];
  for (const table of TABLES) {
    const { error } = await admin.from(table).select("*").limit(0);
    if (!error) found.push(table);
  }

  const report = {
    state: found.length === TABLES.length ? "ok" : "broken",
    tables: { found: found.length, total: TABLES.length },
    missingTables: TABLES.filter((t) => !found.includes(t))
  };

  if (report.state !== "ok") return report;

  // Added later than the rest; a project set up before it silently drops the
  // citations from every saved reply.
  const { error: noSources } = await admin.from("messages").select("sources").limit(0);
  report.schemaCurrent = !noSources;

  // What can someone holding only the public key read? It ships inside every
  // browser that loads the app, so this is the real-world question.
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const exposed = [];
  for (const table of PRIVATE_TABLES) {
    const { data } = await anon.from(table).select("*").limit(1);
    if (data?.length) exposed.push(table);
  }
  report.exposed = exposed;
  if (exposed.length) report.state = "broken";

  const { count } = await admin.from("profiles").select("*", { count: "exact", head: true });
  report.accounts = count ?? 0;

  const { data: usage } = await admin
    .from("usage_events")
    .select("input_tokens, output_tokens")
    .gte("created_at", monthStart());

  report.tokensThisMonth = (usage || []).reduce(
    (sum, row) => sum + row.input_tokens + row.output_tokens,
    0
  );

  return report;
}

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function projectRef(key) {
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).ref || null;
  } catch {
    return null;
  }
}

export { hasSupabase };
