// Routines: list, create, change, delete, and run one on demand.
//
// Everything here is scoped to the signed-in account by the query as well as by
// row-level security, so a routine id belonging to somebody else reads as "no
// such routine" rather than as anything at all.

import { db, hasSupabase, userFromRequest } from "./_supabase.js";
import { MAX_ROUTINES, advance, toClient, validate } from "./_routines.js";
import { runRoutine } from "./_run.js";

export default async function handler(req, res) {
  if (!hasSupabase) {
    return json(res, 501, { error: "Routines need an account, which needs a Supabase project." });
  }

  const user = await userFromRequest(req);
  if (!user) return json(res, 401, { error: "Sign in first." });

  const url = new URL(req.url, "https://selflight");
  const id = url.searchParams.get("id");

  if (req.method === "GET") return list(res, user, url.searchParams.get("runs"));
  if (req.method === "POST" && url.searchParams.get("action") === "run") return runNow(res, user, id);
  if (req.method === "POST") return create(req, res, user);
  if (req.method === "PATCH") return update(req, res, user, id);
  if (req.method === "DELETE") return remove(res, user, id);

  return json(res, 405, { error: "Method not allowed." });
}

/* --------------------------------- reading -------------------------------- */

async function list(res, user, wantRuns) {
  const { data, error } = await db()
    .from("routines")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) return json(res, 500, { error: error.message });

  const routines = (data || []).map(toClient);

  // The last few firings, so a routine that has quietly stopped working is
  // visible without going to the database. Only when asked for: the list is
  // rendered on every panel open and this is a second query.
  let runs = [];
  if (wantRuns) {
    const { data: rows } = await db()
      .from("routine_runs")
      .select("id, routine_id, status, summary, detail, chat_id, created_at, ms")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(40);
    runs = (rows || []).map((row) => ({
      id: row.id,
      routineId: row.routine_id,
      status: row.status,
      summary: row.summary,
      detail: row.detail,
      chatId: row.chat_id,
      ms: row.ms,
      at: row.created_at
    }));
  }

  return json(res, 200, { routines, runs });
}

/* --------------------------------- writing -------------------------------- */

async function create(req, res, user) {
  const body = await readJson(req);
  if (!body) return json(res, 400, { error: "Could not read that." });

  const { count } = await db()
    .from("routines")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  if ((count ?? 0) >= MAX_ROUTINES) {
    return json(res, 400, {
      error: `${MAX_ROUTINES} routines is the limit. Delete one you're not using.`
    });
  }

  const { routine, error } = validate(body);
  if (error) return json(res, 400, { error });

  const row = { ...routine, user_id: user.id };
  row.next_run_at = row.enabled === false ? null : advance(row);

  const { data, error: failed } = await db().from("routines").insert(row).select("*").single();
  if (failed) return json(res, 500, { error: failed.message });

  return json(res, 200, { routine: toClient(data) });
}

async function update(req, res, user, id) {
  if (!id) return json(res, 400, { error: "Which routine?" });

  const body = await readJson(req);
  if (!body) return json(res, 400, { error: "Could not read that." });

  const { routine, error } = validate(body, { partial: true });
  if (error) return json(res, 400, { error });

  const { data: existing } = await db()
    .from("routines")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existing) return json(res, 404, { error: "No such routine." });

  const merged = { ...existing, ...routine, updated_at: new Date().toISOString() };
  // Any change to the schedule, or to whether it runs at all, re-dates it.
  // Leaving a stale next_run_at is how a routine keeps the old time after
  // being edited to a new one.
  merged.next_run_at = merged.enabled === false ? null : advance(merged);

  const { id: _id, user_id: _user, created_at: _created, ...patch } = merged;

  const { data, error: failed } = await db()
    .from("routines")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (failed) return json(res, 500, { error: failed.message });
  return json(res, 200, { routine: toClient(data) });
}

async function remove(res, user, id) {
  if (!id) return json(res, 400, { error: "Which routine?" });

  const { error } = await db().from("routines").delete().eq("id", id).eq("user_id", user.id);
  if (error) return json(res, 500, { error: error.message });
  return json(res, 200, { ok: true });
}

/* ------------------------------- running one ------------------------------ */

async function runNow(res, user, id) {
  if (!id) return json(res, 400, { error: "Which routine?" });

  const { data: routine } = await db()
    .from("routines")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!routine) return json(res, 404, { error: "No such routine." });

  // Deliberately doesn't move next_run_at. "Run now" is a test — it shouldn't
  // cost you the scheduled run you were waiting for.
  const result = await runRoutine(routine, { manual: true });
  return json(res, result.status === "failed" ? 502 : 200, result);
}

/* -------------------------------- plumbing -------------------------------- */

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return null;
  }
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
