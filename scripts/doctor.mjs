// Checks every piece of the stack in the order it has to work, and says what to
// do about anything that doesn't.
//
//   npm run doctor                          # local .env.local
//   npm run doctor -- https://your.app      # also check a deployment
//
// It makes one real, tiny call to each Perplexity model — a few thousandths of
// a cent in total — because "the key is set" and "the key works" are different
// facts, and only one of them is worth knowing.

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { RECENT_COLUMNS } from "../api/doctor.js";

const root = path.resolve(import.meta.dirname, "..");
const target = process.argv[2];

/* --------------------------------- output -------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`
};

let failures = 0;
let warnings = 0;

function section(title) {
  console.log(`\n${c.bold(title)}`);
}

function ok(label, detail) {
  console.log(`  ${c.green("✓")} ${label}${detail ? c.dim(`  ${detail}`) : ""}`);
}

function bad(label, fix) {
  failures++;
  console.log(`  ${c.red("✗")} ${label}`);
  if (fix) console.log(`      ${c.dim("fix:")} ${fix}`);
}

function warn(label, detail) {
  warnings++;
  console.log(`  ${c.yellow("!")} ${label}`);
  if (detail) console.log(`      ${c.dim(detail)}`);
}

function skip(label) {
  console.log(`  ${c.dim("–")} ${c.dim(label)}`);
}

/* ------------------------------ environment ------------------------------ */

// Read .env.local the way Vite does, so `npm run doctor` sees what `npm run
// dev` will see rather than only what's already exported.
function readEnvFile(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return {};

  const found = {};
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;

    let value = match[2].trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    found[match[1]] = value;
  }
  return found;
}

const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const env = (key) => process.env[key] || fileEnv[key] || "";

/* ------------------------------- Perplexity ------------------------------ */

const MODELS = [
  ["sonar", "Quick"],
  ["sonar-pro", "Balanced — the default"],
  ["sonar-reasoning-pro", "Deep"]
];

async function checkPerplexity() {
  section("Model");

  const key = env("PERPLEXITY_API_KEY");
  const claude = env("ANTHROPIC_API_KEY");

  if (!key) {
    if (claude) {
      warn(
        "PERPLEXITY_API_KEY is not set, but ANTHROPIC_API_KEY is",
        "Selflight will run on Claude. That works — this check just can't verify it."
      );
      return;
    }
    bad(
      "No PERPLEXITY_API_KEY",
      "Get one at https://console.perplexity.ai, then put it in .env.local as PERPLEXITY_API_KEY=pplx-..."
    );
    return;
  }

  ok("PERPLEXITY_API_KEY is set", `${key.slice(0, 8)}…`);
  if (claude) {
    warn(
      "ANTHROPIC_API_KEY is also set",
      "Perplexity wins when both are present. Remove one if that isn't what you meant."
    );
  }

  // One real call per model. This is the check that actually matters: it proves
  // the key works, the account is funded, and the model names in prompt.js are
  // still the names Perplexity uses.
  for (const [model, role] of MODELS) {
    const started = Date.now();
    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          max_tokens: 5,
          disable_search: true
        })
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        const message = detail?.error?.message || detail?.detail || `HTTP ${res.status}`;

        if (res.status === 401 || res.status === 403) {
          bad(`${model} — key rejected`, "Check the key was copied whole, with no trailing space.");
        } else if (res.status === 402) {
          bad(`${model} — out of credit`, "Add credit at https://console.perplexity.ai");
        } else if (res.status === 400 && /model/i.test(message)) {
          bad(
            `${model} — Perplexity doesn't recognise this model`,
            `It said: "${message}". Model names move; update TIERS in api/prompt.js.`
          );
        } else {
          bad(`${model} — ${message}`);
        }
        continue;
      }

      const data = await res.json();
      const used = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);
      ok(`${model}`, `${role} · ${Date.now() - started}ms · ${used} tokens`);
    } catch (err) {
      bad(`${model} — couldn't reach Perplexity`, err.message);
    }
  }
}

/* ------------------------------- dictation ------------------------------- */

function checkDictation() {
  section("Dictation");

  // Chrome, Edge and Safari do this in the browser for nothing. This key is
  // only what lets Firefox join in.
  if (!env("TRANSCRIBE_API_KEY")) {
    skip("No TRANSCRIBE_API_KEY — dictation works in Chrome, Edge and Safari, but not Firefox.");
    skip("Set one to cover every browser. See .env.example.");
    return;
  }

  const base = env("TRANSCRIBE_BASE_URL") || "https://api.openai.com/v1";
  ok("Dictation covers every browser", `${env("TRANSCRIBE_MODEL") || "whisper-1"} via ${base}`);
}

/* -------------------------------- Supabase ------------------------------- */

const TABLES = [
  "profiles",
  "user_settings",
  "palettes",
  "chats",
  "messages",
  "connectors",
  "connector_secrets",
  "usage_events",
  "failures"
];

async function checkSupabase() {
  section("Accounts");

  const url = env("VITE_SUPABASE_URL");
  const anonKey = env("VITE_SUPABASE_ANON_KEY");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

  if (!url && !anonKey && !serviceKey) {
    skip("No Supabase configured — Selflight runs signed-out, storing everything in the browser.");
    skip("That's a valid setup. Add the three variables when you want accounts.");
    return;
  }

  if (!url) return bad("VITE_SUPABASE_URL is missing", "Supabase → Project Settings → API → Project URL");
  if (!anonKey) {
    return bad("VITE_SUPABASE_ANON_KEY is missing", "Supabase → Project Settings → API → anon public key");
  }
  if (!serviceKey) {
    return bad(
      "SUPABASE_SERVICE_ROLE_KEY is missing",
      "Supabase → Project Settings → API → service_role secret. Server only — no VITE_ prefix."
    );
  }

  ok("All three Supabase variables are set", url);

  if (serviceKey === anonKey) {
    return bad(
      "The service-role key and the anon key are the same value",
      "They're different keys on the same page. The service_role one is marked secret."
    );
  }

  // A key belongs to exactly one project; mixing two projects produces confusing
  // "session expired" loops that look like an auth bug.
  const ref = /https:\/\/([a-z0-9]+)\.supabase\./.exec(url)?.[1];
  for (const [label, key] of [["anon", anonKey], ["service-role", serviceKey]]) {
    const claimed = projectRef(key);
    if (ref && claimed && claimed !== ref) {
      bad(
        `The ${label} key belongs to a different project (${claimed}, not ${ref})`,
        "Copy both keys from the same project's API settings page."
      );
    }
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });

  // Has the migration run?
  const missing = [];
  for (const table of TABLES) {
    const { error } = await admin.from(table).select("*").limit(0);
    if (error) missing.push(table);
  }

  if (missing.length === TABLES.length) {
    return bad(
      "None of Selflight's tables exist in this project",
      "Supabase → SQL Editor → New query → paste supabase/migrations/0001_init.sql → Run."
    );
  }
  if (missing.length) {
    return bad(
      `Missing ${missing.length} of ${TABLES.length} tables: ${missing.join(", ")}`,
      "Re-run supabase/migrations/0001_init.sql — it's safe to run twice."
    );
  }
  ok(`All ${TABLES.length} tables exist`);

  // Columns the app gained after the first version of the schema. A database
  // created from an earlier one fails every read and write that touches them —
  // which is exactly the "my history doesn't work" report.
  const recent = [];
  const repairs = new Set();

  for (const [table, column, migration] of RECENT_COLUMNS) {
    const { error } = await admin.from(table).select(column).limit(0);
    if (error) {
      recent.push(`${table}.${column}`);
      repairs.add(migration);
    }
  }

  if (recent.length) {
    bad(
      `This database is missing ${recent.join(", ")} — it predates them`,
      `Supabase → SQL Editor → run ${[...repairs]
        .map((m) => `supabase/migrations/${m}`)
        .join(" then ")}. Safe to run twice, and they leave your data alone.`
    );
  } else {
    ok("Schema is current", "every column the app reads is there");
  }

  section("Security");

  // The check worth making on a live project: what can someone with only the
  // public key — which ships to every browser — actually read?
  let leaked = false;
  for (const table of ["chats", "messages", "user_settings", "palettes", "connectors"]) {
    const { data } = await anon.from(table).select("*").limit(1);
    if (data?.length) {
      leaked = true;
      bad(
        `Anyone with the public key can read public.${table}`,
        "Row-level security isn't protecting this table. Re-run 0001_init.sql, and check RLS is on under Supabase → Authentication → Policies."
      );
    }
  }

  const { data: secrets } = await anon.from("connector_secrets").select("*").limit(1);
  if (secrets?.length) {
    leaked = true;
    bad(
      "Connector tokens are readable with the public key",
      "connector_secrets must have RLS on and no policies. Re-run 0001_init.sql."
    );
  }

  if (!leaked) {
    ok("The public key reads nothing without a session");
    ok("Connector tokens are unreachable from a browser");
  }

  section("Spending");

  const cap = Number(env("SELFLIGHT_MONTHLY_TOKEN_CAP") || 2_000_000);
  if (!cap) {
    warn(
      "SELFLIGHT_MONTHLY_TOKEN_CAP is 0 — no per-user limit",
      "One runaway script can spend the whole balance. Set it to 2000000 unless you meant this."
    );
  } else {
    // Roughly 4,600 billed tokens per message on a mid-length thread.
    const messages = Math.round(cap / 4600);
    ok(
      `Cap is ${cap.toLocaleString()} tokens per user per month`,
      `≈ ${messages} messages · about $${((cap / 1e6) * 0.9 * 3 + (cap / 1e6) * 0.1 * 15 + (messages * 0.6 * 10) / 1000).toFixed(0)} each at most`
    );
  }

  const { count } = await admin.from("profiles").select("*", { count: "exact", head: true });
  const { data: usage } = await admin
    .from("usage_events")
    .select("input_tokens, output_tokens")
    .gte("created_at", new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString());

  const spent = (usage || []).reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0);
  ok(
    `${count ?? 0} account${count === 1 ? "" : "s"}, ${spent.toLocaleString()} tokens used this month`,
    spent ? `≈ $${((spent / 1e6) * 0.9 * 3 + (spent / 1e6) * 0.1 * 15).toFixed(2)} in tokens` : "nothing spent yet"
  );
}

// Supabase keys carry the project they belong to; a mismatch is the single most
// common cause of a sign-in that loops.
function projectRef(key) {
  try {
    const body = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    return body.ref || null;
  } catch {
    return null;
  }
}

/* ------------------------------ a deployment ----------------------------- */

async function checkDeployment(base) {
  section(`Deployment · ${base}`);

  // Dictation, and the microphone generally, only work on a secure origin. On
  // Vercel this is automatic — but "automatic" and "true" are different claims,
  // and this is the one that decides whether the mic button works for anyone.
  await checkHttps(base);

  try {
    const res = await fetch(new URL("/api/capabilities", base));
    if (blocked(res)) {
      return warn(
        `Couldn't reach ${new URL(base).host} from here (${res.status})`,
        "The connection was refused before it got there, so nothing below could be checked. Open the address in a browser instead."
      );
    }

    if (!res.ok) {
      return bad(
        `/api/capabilities returned ${res.status}`,
        "Is the api/ folder deployed? Vercel picks it up automatically for a Vite project."
      );
    }

    const caps = await res.json();
    ok(`Answering, on ${caps.provider}`);

    if (!caps.configured) {
      bad(
        "The deployment has no model API key",
        "Vercel → Settings → Environment Variables → PERPLEXITY_API_KEY, then redeploy."
      );
    } else {
      ok("A model key is set on the server");
    }

    // Signed-in-only is the whole point of putting accounts on a public URL.
    const chat = await fetch(new URL("/api/chat", base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", text: "hello" }] })
    });

    if (chat.status === 401) {
      ok("Refuses to answer without a sign-in", "nobody can spend your credit anonymously");
    } else if (chat.status === 200) {
      warn(
        "The deployment answers without a sign-in",
        "Fine while it's private. Add the Supabase variables in Vercel before sharing the URL."
      );
    } else {
      const detail = await chat.json().catch(() => null);
      bad(`/api/chat returned ${chat.status}`, detail?.error);
    }
  } catch (err) {
    bad(`Couldn't reach ${base}`, err.message);
  }
}

// A refusal from the network rather than from the site. Vercel stamps every
// response it serves, so a 403 without that stamp came from somewhere in
// between and says nothing about the deployment.
function blocked(res) {
  if (res.status !== 403 && res.status !== 407) return false;
  return !res.headers.get("x-vercel-id") && !res.headers.get("server");
}

async function checkHttps(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    return bad(`"${base}" isn't a URL`, "Pass the full address, e.g. https://your-app.vercel.app");
  }

  if (url.protocol === "https:") {
    try {
      const res = await fetch(url.origin, { method: "HEAD" });

      // A response is not the same as *your* response. A corporate proxy, a
      // captive network, or a sandbox's egress policy will answer 403 to the
      // connection itself, and fetch reports that as an ordinary reply rather
      // than throwing — so an unauthenticated 403/407 means "something in
      // between answered", not "your site said no".
      if (blocked(res)) {
        return warn(
          `Something between here and ${url.host} refused the connection (${res.status})`,
          "A proxy, a firewall, or Vercel's Deployment Protection. Open the address in a browser — that's the answer that counts."
        );
      }

      ok(`Served over https (${res.status})`, "certificate verified — the microphone will work here");
    } catch (err) {
      bad("Couldn't establish https", err.message);
    }
    return;
  }

  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return ok("localhost counts as a secure origin", "the microphone works here without https");
  }

  bad(
    `${url.origin} is plain http, so browsers won't allow the microphone`,
    "Use the deployed https address. A local network IP can't do dictation, whatever the browser."
  );
}

/* --------------------------------- run it -------------------------------- */

console.log(c.bold("\nSelflight · checking the stack"));

await checkPerplexity();
checkDictation();
await checkSupabase();
if (target) await checkDeployment(target);

console.log();
if (failures) {
  console.log(c.red(`${failures} thing${failures === 1 ? "" : "s"} to fix`) + c.dim(" — see the fix lines above"));
} else if (warnings) {
  console.log(c.green("Working.") + c.dim(` ${warnings} thing${warnings === 1 ? "" : "s"} worth a look.`));
} else {
  console.log(c.green("Everything checks out."));
}
console.log();

process.exit(failures ? 1 : 0);
