// What went wrong, written down.
//
// Three rules shaped this file:
//
// 1. Recording a failure must never cause one. Every path here swallows its own
//    errors and returns — a reply that already happened must not be lost
//    because the bookkeeping about it couldn't be saved.
//
// 2. No conversation content, ever. A failure report that quotes what somebody
//    asked stops being a debugging aid and becomes a transcript. What's stored
//    is the shape of the request: route, provider, model, which connectors were
//    involved, how long it took, what the error said.
//
// 3. The same failure is one row, not one per occurrence. A connector that
//    times out on every message would otherwise file four hundred identical
//    tickets overnight, and the workflow reading them would email about each.
//    Fingerprinting collapses them and counts instead.

import crypto from "node:crypto";
import { db, hasSupabase } from "./_supabase.js";

export const KINDS = [
  "model",
  "connector",
  "store",
  "transcribe",
  "oauth",
  // The assistant said it didn't know. Not a bug — see admittedNotKnowing.
  "unknown",
  // A person said the reply was wrong. The only source for a failure the
  // server has no way to detect, because nothing crashed.
  "feedback"
];

export const SEVERITIES = ["error", "degraded", "unknown", "reported"];

/**
 * Reduces a failure to what makes it *that* failure rather than this instance
 * of it. Deliberately excludes anything per-request — no user, no timestamp, no
 * chat — so two people hitting the same broken connector produce one row.
 *
 * Numbers, uuids, quoted strings and urls are stripped out of the detail: an
 * error saying `request 4a1f… timed out after 30001ms` is the same error as one
 * saying `request 9c22… timed out after 30004ms`, and treating them as
 * different is how a log becomes noise.
 */
export function fingerprint({ kind, summary, detail = "", context = {} }) {
  const shape = String(detail)
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/["'`][^"'`]{0,80}["'`]/g, "<str>")
    // No \b around this: the boundary between "30001" and "ms" isn't one, so
    // \b\d+\b leaves every duration in place and each millisecond of variance
    // opens its own ticket.
    .replace(/\d+(?:\.\d+)?/g, "<n>")
    .slice(0, 400);

  const parts = [kind, summary, shape, context.provider || "", context.route || ""];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/**
 * Files a failure. Returns the stored row, or null if there was nowhere to put
 * it — which is a normal state, not an error: Polstar runs with no database
 * at all, and a browser-only session has no failure log by design.
 *
 * @param {object} f
 * @param {string} f.kind      one of KINDS
 * @param {string} f.summary   one line, stable across occurrences — it's half the fingerprint
 * @param {string} [f.detail]  the error message or stack
 * @param {object} [f.context] route, provider, model, connectors, timings. No content.
 * @param {string} [f.severity]
 * @param {string} [f.recovery] what the app did about it by itself
 * @param {boolean} [f.recovered]
 * @param {string} [f.userId]
 */
export async function record(f) {
  if (!hasSupabase || !f?.summary) return null;

  const row = {
    kind: KINDS.includes(f.kind) ? f.kind : "unknown",
    severity: SEVERITIES.includes(f.severity) ? f.severity : "error",
    summary: String(f.summary).slice(0, 300),
    detail: f.detail ? String(f.detail).slice(0, 4000) : null,
    context: f.context || {},
    recovered: Boolean(f.recovered),
    recovery: f.recovery ? String(f.recovery).slice(0, 500) : null,
    user_id: f.userId || null,
    fingerprint: fingerprint(f)
  };

  try {
    const client = db();

    // Bump the open row if this has happened before. The partial unique index
    // is on open rows only, so a failure that was resolved and then came back
    // opens a fresh ticket rather than silently incrementing a closed one.
    const { data: open } = await client
      .from("failures")
      .select("id, seen")
      .eq("fingerprint", row.fingerprint)
      .in("status", ["new", "sent"])
      .maybeSingle();

    if (open) {
      await client
        .from("failures")
        .update({ seen: open.seen + 1, last_seen_at: new Date().toISOString() })
        .eq("id", open.id);
      // Deliberately no webhook on a repeat: the workflow already has this one.
      return { ...row, id: open.id, seen: open.seen + 1, repeat: true };
    }

    const { data, error } = await client.from("failures").insert(row).select("*").single();
    if (error) {
      console.error(`[failures] couldn't record: ${error.message}`);
      return null;
    }

    await notify(data);
    return data;
  } catch (err) {
    // The last place that can go wrong. Log and carry on — whatever called this
    // has more important work than the report about it.
    console.error(`[failures] ${err?.message || err}`);
    return null;
  }
}

/**
 * Tells the workflow a new failure exists, if one is listening. Fire and
 * forget: a webhook that's down must not slow down or fail the request that
 * happened to notice the problem.
 *
 * The row is already in the database either way, so a missed webhook costs
 * latency on the fix, not the record of it — api/failures.js will hand it over
 * on the next poll.
 */
async function notify(row) {
  const url = process.env.N8N_FAILURE_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.FAILURE_FEED_SECRET
          ? { "X-Polstar-Secret": process.env.FAILURE_FEED_SECRET }
          : {})
      },
      body: JSON.stringify({ event: "failure", failure: row }),
      // Long enough for a normal webhook, short enough not to hold a reply.
      signal: AbortSignal.timeout(4000)
    });
  } catch (err) {
    console.warn(`[failures] webhook: ${err?.message || err}`);
  }
}

/* ------------------------------- honesty --------------------------------- */

// Phrasings that mean the assistant declined to guess. Kept narrow on purpose:
// this must not fire on "I don't know why that happens, but here's what does"
// or on the model quoting somebody else, so each pattern anchors to a statement
// about its own knowledge.
const ADMISSIONS = [
  /\bI (?:don'?t|do not) (?:know|have) (?:the answer|enough|any)\b/i,
  /\bI (?:don'?t|do not) know\.(?:\s|$)/i,
  /\bI'?m not (?:sure|certain) (?:enough )?(?:about|what|how|why|whether|if)\b/i,
  /\bI can'?t (?:tell|say|determine|verify|confirm) (?:that|this|from|without|whether)\b/i,
  /\bI don'?t have (?:access|the ability|enough information|a way)\b/i,
  /\bthat'?s outside what I (?:know|can)\b/i,
  /\bI(?:'| a)m unable to (?:verify|confirm|check)\b/i
];

/**
 * Did the assistant say it didn't know?
 *
 * This is the one entry in the failure log that isn't a bug. Saying so instead
 * of guessing is the behaviour we want — but *where* it happens is the clearest
 * signal there is of what the product can't do yet, and that's worth having
 * written down rather than scrolled past.
 */
export function admittedNotKnowing(text) {
  const answer = String(text || "");
  if (answer.length < 12) return null;

  for (const pattern of ADMISSIONS) {
    const found = pattern.exec(answer);
    if (found) return found[0].trim();
  }
  return null;
}
