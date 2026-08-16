// Server-side Supabase, with the service-role key.
//
// This key bypasses row-level security entirely, so it must never reach the
// browser — that's why it has no VITE_ prefix and why nothing in src/ imports
// this file. The underscore keeps Vercel from turning it into a route.

import { createClient } from "@supabase/supabase-js";
import { CREDITS_PER_MESSAGE, TOKENS_PER_MESSAGE, costOf, creditsForModel, planFor } from "./_pricing.js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// With no project configured Polstar runs signed-out and browser-only, which
// is how `npm run dev` works before you've set any of this up.
export const hasSupabase = Boolean(url && serviceKey);

// A deployment-wide override for the per-plan allowance, in credits. Unset
// means every account gets its plan's allowance, which is the intended
// behaviour once there's something to sell; set it while everyone is on the
// same footing. 0 removes the limit entirely.
//
// Null rather than a number when unset, so "no override" and "no limit" stay
// distinguishable — a `?? 2_000` default would silently outrank every plan.
//
// The old SELFLIGHT_MONTHLY_TOKEN_CAP is still honoured, converted, so a
// deployment that has one set doesn't silently become unlimited the moment
// allowances stop being counted in tokens. The new name wins where both exist.
const read = (name) =>
  process.env[name] === undefined || process.env[name] === "" ? null : Number(process.env[name]);

const legacyTokens = read("SELFLIGHT_MONTHLY_TOKEN_CAP");

export const MONTHLY_CREDIT_CAP =
  read("POLSTAR_MONTHLY_CREDIT_CAP") ??
  (legacyTokens === null
    ? null
    : legacyTokens === 0
      ? 0
      : Math.max(1, Math.round((legacyTokens / TOKENS_PER_MESSAGE) * CREDITS_PER_MESSAGE)));

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
 * Returns { used, cap, exceeded, spent, plan, messages }, where `used` and
 * `cap` are credits and `spent` is micro-dollars.
 *
 * The allowance comes from the person's plan, with POLSTAR_MONTHLY_CREDIT_CAP
 * as an override for a deployment that isn't selling anything yet — which is
 * what every deployment is on its first day.
 *
 * Reading usage failing is not a reason to refuse somebody service, so it fails
 * open and says so in the log.
 */
export async function usageThisMonth(userId) {
  const plan = await planOf(userId);
  // An explicit env cap wins, then the plan's. Zero in either means no limit —
  // which is right for bring-your-own-key, where the tokens aren't ours.
  const cap = MONTHLY_CREDIT_CAP ?? plan.credits;

  const { data, error } = await db()
    .from("usage_events")
    .select("credits, input_tokens, output_tokens, model, cost_micros")
    .eq("user_id", userId)
    .gte("created_at", monthStart());

  if (error) {
    console.error(`[api] reading usage: ${error.message}`);
    return { used: 0, spent: 0, cap, plan, messages: 0, exceeded: false };
  }

  const rows = data || [];
  const used = rows.reduce((sum, r) => sum + creditsOf(r), 0);
  const spent = rows.reduce((sum, r) => sum + Number(r.cost_micros || 0), 0);

  return {
    used,
    spent,
    cap,
    plan,
    // What's left, in the unit the person was sold.
    messages: cap ? Math.max(0, Math.floor((cap - used) / CREDITS_PER_MESSAGE)) : Infinity,
    exceeded: Boolean(cap) && used >= cap
  };
}

// Rows written before credits existed have none. Estimating from tokens keeps
// this month's usage continuous across the change — counting those rows as
// zero would hand every existing account a fresh allowance on deploy day.
function creditsOf(row) {
  if (row.credits !== null && row.credits !== undefined) return Number(row.credits);
  const tokens = (row.input_tokens || 0) + (row.output_tokens || 0);
  if (!tokens) return 0;
  return Math.max(1, Math.round((tokens / TOKENS_PER_MESSAGE) * creditsForModel(row.model)));
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
  { kind = "chat", model, input = 0, output = 0, searched = true, credits = null }
) {
  if (!userId || (!input && !output)) return;

  // Credits are what the allowance is spent in, so a turn that somehow arrives
  // without them still costs the model's going rate rather than nothing.
  const charged = credits ?? creditsForModel(model);

  const { error } = await db().from("usage_events").insert({
    user_id: userId,
    kind,
    model,
    input_tokens: input,
    output_tokens: output,
    searched,
    credits: charged,
    cost_micros: costOf({ model, input, output, searched })
  });

  // Never fail a reply that already happened because the bookkeeping didn't.
  if (error) console.error(`[api] recording usage: ${error.message}`);
}

/* -------------------------------- billing -------------------------------- */

/**
 * The billing row for an account: plan id, Stripe ids, period end.
 *
 * Read with the service role, so it sees columns the browser's policy allows it
 * to read about itself and nothing about anyone else.
 */
export async function billingFor(userId) {
  if (!hasSupabase || !userId) return null;

  const { data, error } = await db()
    .from("profiles")
    .select("plan, plan_since, plan_until, stripe_customer_id, stripe_subscription_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error(`[api] reading billing: ${error.message}`);
    return null;
  }
  return data || {};
}

/** Remember which Stripe customer an account is, so the webhook can find it. */
export async function saveStripeCustomer(userId, customerId) {
  if (!hasSupabase || !userId || !customerId) return;

  const { error } = await db()
    .from("profiles")
    .upsert({ id: userId, stripe_customer_id: customerId }, { onConflict: "id" });

  if (error) console.error(`[api] saving stripe customer: ${error.message}`);
}

/**
 * Which account a Stripe customer belongs to.
 *
 * The webhook's only reliable handle on identity. It must come from this
 * lookup rather than from anything in the request — a user id read out of a
 * payload is a user id somebody can choose.
 */
export async function userIdForCustomer(customerId) {
  if (!hasSupabase || !customerId) return null;

  const { data, error } = await db()
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) {
    console.error(`[api] resolving stripe customer: ${error.message}`);
    return null;
  }
  return data?.id || null;
}

/**
 * Put an account on a plan. The only function that does.
 *
 * `eventId` is Stripe's id for the delivery that caused this. Stripe retries,
 * and events can arrive out of order — an upgrade's `updated` can land after
 * the old subscription's `deleted`. Recording the id makes a repeat a no-op,
 * and callers pass the subscription's own timestamps so a late delivery can be
 * recognised as late rather than applied on top of newer state.
 */
export async function setPlan(userId, planId, { subscriptionId = null, until = null, eventId = null } = {}) {
  if (!hasSupabase || !userId) return { ok: false, reason: "no user" };

  // An unknown plan id becomes free rather than being written through. A typo
  // in an environment variable must cost somebody their plan, never hand them
  // the largest one we sell.
  const plan = planFor(planId).id;

  if (eventId) {
    const { data } = await db()
      .from("profiles")
      .select("stripe_event_id")
      .eq("id", userId)
      .maybeSingle();

    if (data?.stripe_event_id === eventId) return { ok: true, repeated: true, plan };
  }

  const { error } = await db().from("profiles").upsert(
    {
      id: userId,
      plan,
      plan_since: new Date().toISOString(),
      plan_until: until,
      stripe_subscription_id: subscriptionId,
      stripe_event_id: eventId
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error(`[api] setting plan: ${error.message}`);
    return { ok: false, reason: error.message };
  }
  return { ok: true, plan };
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
