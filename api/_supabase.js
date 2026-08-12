// Server-side Supabase, with the service-role key.
//
// This key bypasses row-level security entirely, so it must never reach the
// browser — that's why it has no VITE_ prefix and why nothing in src/ imports
// this file. The underscore keeps Vercel from turning it into a route.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// With no project configured Selflight runs signed-out and browser-only, which
// is how `npm run dev` works before you've set any of this up.
export const hasSupabase = Boolean(url && serviceKey);

// A cap per user per calendar month, counting input and output tokens together.
// Set to 0 to remove it. This is the difference between one enthusiastic tester
// and a bill you didn't agree to.
export const MONTHLY_TOKEN_CAP = Number(process.env.SELFLIGHT_MONTHLY_TOKEN_CAP ?? 2_000_000);

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
    client.from("connectors").select("id, name, url, enabled").eq("user_id", userId),
    client.from("connector_secrets").select("connector_id, token").eq("user_id", userId)
  ]);

  if (error) {
    console.error(`[api] loading connectors: ${error.message}`);
    return [];
  }

  const tokens = new Map((secrets || []).map((s) => [s.connector_id, s.token]));
  return (rows || []).map((row) => ({ ...row, token: tokens.get(row.id) || "" }));
}

/* --------------------------------- usage --------------------------------- */

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// Returns { used, cap, exceeded }. A failure to read usage is not a reason to
// refuse someone service, so it fails open and says so in the log.
export async function usageThisMonth(userId) {
  if (!MONTHLY_TOKEN_CAP) return { used: 0, cap: 0, exceeded: false };

  const { data, error } = await db()
    .from("usage_events")
    .select("input_tokens, output_tokens")
    .eq("user_id", userId)
    .gte("created_at", monthStart());

  if (error) {
    console.error(`[api] reading usage: ${error.message}`);
    return { used: 0, cap: MONTHLY_TOKEN_CAP, exceeded: false };
  }

  const used = (data || []).reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0);
  return { used, cap: MONTHLY_TOKEN_CAP, exceeded: used >= MONTHLY_TOKEN_CAP };
}

export async function recordUsage(userId, { kind = "chat", model, input = 0, output = 0 }) {
  if (!userId || (!input && !output)) return;

  const { error } = await db().from("usage_events").insert({
    user_id: userId,
    kind,
    model,
    input_tokens: input,
    output_tokens: output
  });

  // Never fail a reply that already happened because the bookkeeping didn't.
  if (error) console.error(`[api] recording usage: ${error.message}`);
}
