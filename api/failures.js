// The failure log, for whatever is going to act on it.
//
//   GET   /api/failures?status=new&limit=50   → the open ones, oldest first
//   PATCH /api/failures  { id, status }       → mark one sent, resolved, wontfix
//
// Both need `X-Selflight-Secret` matching FAILURE_FEED_SECRET. Not a session:
// the thing reading this is a workflow, not a person, and giving it a Selflight
// account would mean a browser somewhere could hold the same credential.
//
// With no secret set the route is off entirely rather than open. An unguarded
// list of every way a deployment breaks is a gift to somebody looking for one.

import crypto from "node:crypto";
import { db, hasSupabase } from "./_supabase.js";

const STATUSES = ["new", "sent", "resolved", "wontfix"];

export default async function handler(req, res) {
  const secret = process.env.FAILURE_FEED_SECRET;
  if (!secret) {
    return json(res, 501, {
      error:
        "The failure feed is off. Set FAILURE_FEED_SECRET to a long random string and send it as X-Selflight-Secret."
    });
  }
  if (!hasSupabase) return json(res, 501, { error: "No Supabase project is configured." });

  if (!authorised(req, secret)) return json(res, 401, { error: "Bad or missing secret." });

  if (req.method === "GET") return list(req, res);
  if (req.method === "PATCH" || req.method === "POST") return update(req, res);
  return json(res, 405, { error: "Method not allowed." });
}

// Constant-time, and length-safe: comparing with === leaks how much of a guess
// was right through timing, and timingSafeEqual throws on a length mismatch.
function authorised(req, secret) {
  const given = String(req.headers["x-selflight-secret"] || "");
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ---------------------------------- read --------------------------------- */

async function list(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const status = url.searchParams.get("status") || "new";
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

  if (status !== "all" && !STATUSES.includes(status)) {
    return json(res, 400, { error: `status must be one of ${STATUSES.join(", ")}, or all.` });
  }

  let query = db()
    .from("failures")
    // Oldest first: a workflow working through a backlog should fix what broke
    // first, and the first break is often the cause of the rest.
    .order("created_at", { ascending: true })
    .limit(limit);

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query.select(
    "id, created_at, last_seen_at, kind, severity, summary, detail, context, recovered, recovery, status, fingerprint, seen"
  );

  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { failures: data || [], count: (data || []).length });
}

/* --------------------------------- write --------------------------------- */

async function update(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "Could not parse the request body." });
  }

  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!id) return json(res, 400, { error: "Which failure?" });
  if (!STATUSES.includes(status)) {
    return json(res, 400, { error: `status must be one of ${STATUSES.join(", ")}.` });
  }

  // `note` is where the workflow says what it did — the PR it opened, why it
  // gave up, who it emailed. It belongs with the failure, not in a log
  // somewhere else that has to be correlated by hand later.
  const patch = { status };
  if (typeof body.note === "string") patch.recovery = body.note.slice(0, 500);

  const { data, error } = await db()
    .from("failures")
    .update(patch)
    .eq("id", id)
    .select("id, status, recovery")
    .maybeSingle();

  if (error) return json(res, 500, { error: error.message });
  if (!data) return json(res, 404, { error: "No such failure." });
  return json(res, 200, { failure: data });
}

/* -------------------------------- plumbing ------------------------------- */

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

export { authorised };
