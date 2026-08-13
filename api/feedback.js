// "This reply was wrong."
//
// The failure log already collects the crashes. This is the other half, and the
// more valuable one: a reply that worked perfectly — streamed, saved, no error
// anywhere — and was still wrong. Nothing on the server can detect that. Only
// the person reading it can.
//
// It lands in the same table the repair workflow reads, so a run of bad answers
// about one subject shows up next to the exceptions rather than in a separate
// dashboard nobody opens.

import { record } from "./_failures.js";
import { hasSupabase, userFromRequest } from "./_supabase.js";

const REASONS = {
  wrong: "The answer was wrong",
  invented: "It made something up",
  unhelpful: "It didn't answer the question",
  refused: "It wouldn't help when it should have",
  other: "Something else"
};

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
  if (!hasSupabase) return json(res, 200, { ok: true, stored: false });

  const user = await userFromRequest(req);
  if (!user) return json(res, 401, { error: "Sign in first." });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "Could not parse the request body." });
  }

  const reason = REASONS[body.reason] ? body.reason : "other";

  // The report says a reply was wrong; it does not say what the reply was. The
  // same rule as everywhere else in the failure log — this is a debugging aid,
  // not a transcript, and the person flagging a bad answer about something
  // private hasn't agreed to hand it over.
  //
  // What makes a report actionable instead is the shape: which provider, which
  // depth, whether it had searched, whether tools were involved. A run of
  // "invented" against one depth setting is a finding on its own.
  await record({
    kind: "feedback",
    severity: "reported",
    summary: REASONS[reason],
    detail: null,
    context: {
      route: "/api/feedback",
      reason,
      provider: String(body.provider || "").slice(0, 40) || null,
      depth: String(body.depth || "").slice(0, 20) || null,
      hadSources: Boolean(body.hadSources),
      hadThinking: Boolean(body.hadThinking),
      connectors: Number(body.connectors) || 0
    },
    userId: user.id
  });

  return json(res, 200, { ok: true, stored: true });
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
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

export { REASONS };
