// The same checks scripts/doctor.mjs runs, answered over HTTP so the app can
// show them on a screen. Setting this up shouldn't require a terminal.
//
// Nothing secret comes back: booleans, counts, and the provider's name. Never a
// key, never a row, never an email. The one sensitive-looking field is whether
// the public key can read private tables — and if that's true the data is
// already public, so hiding the flag would protect nobody and inform no one.

import { createClient } from "@supabase/supabase-js";
import { provider } from "./provider.js";
import { MONTHLY_CREDIT_CAP, hasSupabase } from "./_supabase.js";
import { PLANS, marginOf, messagesIn, money } from "./_pricing.js";

const TABLES = [
  "profiles",
  "user_settings",
  "palettes",
  "chats",
  "messages",
  "connectors",
  "connector_secrets",
  "usage_events",
  "failures",
  "user_keys",
  "projects",
  "routines",
  "routine_runs"
];

const PRIVATE_TABLES = [
  "chats",
  "messages",
  "user_settings",
  "connector_secrets",
  "failures",
  "user_keys",
  "projects",
  "routines",
  "routine_runs"
];

// Columns the app gained after the first version of the schema, each with the
// migration that adds it. A database created before one of these fails every
// read and write that touches it while its tables and policies all look
// correct — which is what "the history doesn't work" turned out to mean.
//
// Shared with scripts/doctor.mjs, and asserted against the migrations
// themselves in doctor.test.mjs, so a column added to the schema without being
// added here fails a test rather than a user.
export const RECENT_COLUMNS = [
  ["messages", "sources", "0002_repair.sql"],
  ["messages", "thinking", "0002_repair.sql"],
  ["messages", "thought_ms", "0002_repair.sql"],
  ["connectors", "has_token", "0002_repair.sql"],
  ["connectors", "provider", "0003_connections.sql"],
  ["connectors", "account", "0003_connections.sql"],
  ["connector_secrets", "refresh_token", "0003_connections.sql"],
  ["connector_secrets", "expires_at", "0003_connections.sql"],
  ["usage_events", "cost_micros", "0005_money.sql"],
  ["usage_events", "searched", "0005_money.sql"],
  ["usage_events", "credits", "0009_credits.sql"],
  ["profiles", "plan", "0005_money.sql"],
  ["profiles", "plan_since", "0005_money.sql"],
  ["chats", "pinned", "0006_chats.sql"],
  ["messages", "search", "0006_chats.sql"],
  // Only columns added to a table that already existed. A whole new table is
  // caught by the table check above, and listing its columns here would claim a
  // migration "adds" something it creates — which is what the test below
  // objected to, correctly.
  ["chats", "project_id", "0007_projects_routines.sql"],
  ["connectors", "kind", "0008_apis.sql"],
  ["connectors", "base_url", "0008_apis.sql"],
  ["connectors", "auth_style", "0008_apis.sql"],
  ["connectors", "methods", "0008_apis.sql"],
  ["connectors", "auth_name", "0008_apis.sql"],
  ["connectors", "description", "0008_apis.sql"],
  ["connectors", "docs", "0008_apis.sql"]
];

export default async function handler(req, res) {
  const live = /[?&]live=1/.test(req.url || "");

  const report = {
    model: await checkModel(live),
    accounts: await checkAccounts(),
    cap: MONTHLY_CREDIT_CAP,
    // What's on sale, with the margin arithmetic already done. Published here
    // rather than restated in the interface, so a price can only ever be
    // changed in one place.
    plans: Object.values(PLANS).map((plan) => {
      const { revenue, worstCost, ratio } = marginOf(plan);
      return {
        id: plan.id,
        name: plan.name,
        blurb: plan.blurb,
        priceCents: plan.priceCents,
        // Reported through messagesIn() rather than divided by a literal here.
        // The old line was `plan.cap / 4600` — a hardcoded copy of a constant
        // that lives in _pricing.js, so the day the allowance stopped being
        // counted in tokens this quietly reported nonsense instead of failing.
        messages: messagesIn(plan) || null,
        credits: plan.credits || null,
        deep: plan.deep !== false,
        connectors: plan.connectors,
        margin: {
          revenue: money(revenue),
          worstCost: money(worstCost),
          worstRatio: Math.round(ratio * 100)
        }
      };
    })
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

  // No Supabase at all is a supported setup, not a broken one: Polstar runs
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

  // Every one of them, not just the first: a row is written with all its
  // columns at once, so any single absence fails the whole write. Checking
  // `sources` alone once let the other two go missing behind a green tick.
  const missingColumns = [];
  const repairWith = new Set();

  for (const [table, column, migration] of RECENT_COLUMNS) {
    const { error } = await admin.from(table).select(column).limit(0);
    if (error) {
      missingColumns.push(`${table}.${column}`);
      repairWith.add(migration);
    }
  }

  report.missingColumns = missingColumns;
  report.repairWith = [...repairWith];
  report.schemaCurrent = missingColumns.length === 0;
  if (missingColumns.length) report.state = "broken";

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
    .select("user_id, input_tokens, output_tokens, cost_micros")
    .gte("created_at", monthStart());

  const rows = usage || [];
  report.tokensThisMonth = rows.reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0);

  // What it actually costs, which is the only version of this number that can
  // be compared against a price. Tokens tell you nothing about whether the
  // business works.
  const spent = rows.reduce((sum, r) => sum + Number(r.cost_micros || 0), 0);
  const spenders = new Set(rows.map((r) => r.user_id)).size;

  report.spend = {
    micros: spent,
    display: money(spent),
    activeUsers: spenders,
    // The figure that decides pricing: what one person who actually uses it
    // costs to serve for a month. An average over signups instead of over
    // *users* would flatter it with everyone who never came back.
    perActiveUser: spenders ? money(Math.round(spent / spenders)) : money(0),
    perMessage: rows.length ? money(Math.round(spent / rows.length)) : money(0),
    calls: rows.length
  };

  // Counts only. What broke is in the failure log, which needs a secret to
  // read — but knowing *whether* anything is broken shouldn't.
  const [{ count: openFailures }, { count: notKnown }] = await Promise.all([
    admin
      .from("failures")
      .select("*", { count: "exact", head: true })
      .in("status", ["new", "sent"])
      .neq("severity", "unknown"),
    admin
      .from("failures")
      .select("*", { count: "exact", head: true })
      .eq("severity", "unknown")
      .gte("created_at", monthStart())
  ]);

  report.failures = { open: openFailures ?? 0, saidUnsure: notKnown ?? 0 };

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
