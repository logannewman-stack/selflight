// Server-side Supabase, with the service-role key.
//
// This key bypasses row-level security entirely, so it must never reach the
// browser — that's why it has no VITE_ prefix and why nothing in src/ imports
// this file. The underscore keeps Vercel from turning it into a route.

import { createClient } from "@supabase/supabase-js";
import { costOf, planFor } from "./_pricing.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// With no project configured Selflight runs signed-out and browser-only, which
// is how `npm run dev` works before you've set any of this up.
export const hasSupabase = Boolean(url && serviceKey);

// A deployment-wide override for the per-plan cap, counting input and output
// tokens together. Unset means every account gets its plan's allowance, which
// is the intended behaviour once there's something to sell; set it while
// everyone is on the same footing. 0 removes the limit entirely.
//
// Null rather than a number when unset, so "no override" and "no limit" stay
// distinguishable — a `?? 2_000_000` default would silently outrank every plan.
export const MONTHLY_TOKEN_CAP =
  process.env.SELFLIGHT_MONTHLY_TOKEN_CAP === undefined ||
  process.env.SELFLIGHT_MONTHLY_TOKEN_CAP === ""
    ? null
    : Number(process.env.SELFLIGHT_MONTHLY_TOKEN_CAP);

let admin;

export function db() {
  if (!admin) {
    admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return admin;
}

function bearer(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  return match ? match[1].trim() : null;
}

// Returns the user the request's token belongs to, or null. The token is
// verified against Supabase rather than merely decoded, so a hand-written JWT
// gets nowhere.
export async function userFromRequest(req) {
  if (!hasSupabase) return null;

  const token = bearer(req);
  if (!token) return null;

  const { data, error } = await db().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

/* ------------------------------- connectors ------------------------------ */

// Read connectors from the database rather than from the request body, so the
// tokens live server-side for their whole life. A browser that lies about its
// connectors changes nothing.
export async function connectorsFor(userId) {
  const client = db();

  const [{ data: rows, error }, { data: secrets }] = await Promise.all([
    client
      .from("connectors")
      // The http columns come back too, or an API connector reaches the model
      // as a tool with no address and every call fails on a field that was
      // simply never selected.
      .select(
        "id, name, url, enabled, kind, base_url, auth_style, auth_name, methods, description, docs"
      )
      .eq("user_id", userId),
    client.from("connector_secrets").select("connector_id, token").eq("user_id", userId)
  ]);

  if (error) {
    console.error(`[api] loading connectors: ${error.message}`);
    return [];
  }

  const tokens = new Map((secrets || []).map((s) => [s.connector_id, s.token]));
  return (rows || []).map((row) => ({
    ...row,
    kind: row.kind || "mcp",
    baseUrl: row.base_url || null,
    authStyle: row.auth_style || "bearer",
    authName: row.auth_name || null,
    methods: Array.isArray(row.methods) ? row.methods : ["GET", "HEAD"],
    token: tokens.get(row.id) || ""
  }));
}

/* --------------------------------- usage --------------------------------- */

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Which plan someone is on. Null, unknown, or unreadable all mean free — the
 * cheapest answer, so a database hiccup can never hand out an unlimited
 * allowance by accident.
 */
export async function planOf(userId) {
  if (!userId) return planFor("free");

  const { data, error } = await db()
    .from("profiles")
    .select("plan, plan_since")
    .eq("id", userId)
    .maybeSingle();

  if (error) console.error(`[api] reading plan: ${error.message}`);
  return { ...planFor(data?.plan), since: data?.plan_since || null };
}

/**
 * Returns { used, cap, exceeded, spent, plan }, where `used` is tokens and
 * `spent` is micro-dollars.
 *
 * The cap comes from the person's plan, with SELFLIGHT_MONTHLY_TOKEN_CAP as an
 * override for a deployment that isn't selling anything yet — which is what
 * every deployment is on its first day.
 *
 * Reading usage failing is not a reason to refuse somebody service, so it fails
 * open and says so in the log.
 */
export async function usageThisMonth(userId) {
  const plan = await planOf(userId);
  // An explicit env cap wins, then the plan's. Zero in either means no limit —
  // which is right for bring-your-own-key, where the tokens aren't ours.
  const cap = MONTHLY_TOKEN_CAP ?? plan.cap;

  const { data, error } = await db()
    .from("usage_events")
    .select("input_tokens, output_tokens, cost_micros")
    .eq("user_id", userId)
    .gte("created_at", monthStart());

  if (error) {
    console.error(`[api] reading usage: ${error.message}`);
    return { used: 0, spent: 0, cap, plan, exceeded: false };
  }

  const rows = data || [];
  const used = rows.reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0);
  const spent = rows.reduce((sum, r) => sum + Number(r.cost_micros || 0), 0);

  return { used, spent, cap, plan, exceeded: Boolean(cap) && used >= cap };
}

/**
 * One row per model call, priced at the moment it happened.
 *
 * The cost is computed here rather than derived later on purpose: rates change,
 * and a figure recomputed at today's prices against last quarter's traffic
 * looks precise and isn't.
 */
export async function recordUsage(
  userId,
  { kind = "chat", model, input = 0, output = 0, searched = true }
) {
  if (!userId || (!input && !output)) return;

  const { error } = await db().from("usage_events").insert({
    user_id: userId,
    kind,
    model,
    input_tokens: input,
    output_tokens: output,
    searched,
    cost_micros: costOf({ model, input, output, searched })
  });

  // Never fail a reply that already happened because the bookkeeping didn't.
  if (error) console.error(`[api] recording usage: ${error.message}`);
}

/**
 * A project's name and instructions, or null.
 *
 * Read from the database with the user's id in the query rather than trusted
 * from the request. The instructions are the person's own, so a forged id would
 * only ever fetch something they can already see — but a lookup that ignores
 * the owner is one refactor away from being a leak, and this one never was.
 */
export async function projectFor(userId, projectId) {
  if (!hasSupabase || !userId || !projectId) return null;

  const { data, error } = await db()
    .from("projects")
    .select("id, name, instructions")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}
