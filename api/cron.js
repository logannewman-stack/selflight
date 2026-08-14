// The scheduler. Called on a timer by Vercel Cron, and by nothing else.
//
// It takes whatever is due, runs it, and moves each routine's next_run_at
// forward. Everything about *when* lives in src/lib/schedule.js; this file is
// only the sweep.
//
// Moving next_run_at happens before the run, not after. A routine that takes 40
// seconds and a sweep that fires every minute would otherwise pick the same
// routine up twice and answer the same question twice — billed twice, delivered
// twice. Claiming it first means the worst case is a missed run rather than a
// duplicated one, and a missed run is visible in the run log while a duplicate
// is just confusing.

import { db, hasSupabase } from "./_supabase.js";
import { advance, dueNow } from "./_routines.js";
import { runRoutine } from "./_run.js";

// Runs are sequential and a model call can take a while, so the sweep takes a
// batch rather than everything due. Anything left over is picked up next time.
const BATCH = 8;

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!hasSupabase) {
    return json(res, 501, { error: "Routines need a Supabase project." });
  }
  if (!authorised(req)) {
    return json(res, 401, { error: "Not for you." });
  }

  const now = new Date();
  const due = await dueNow(BATCH, now);

  const results = [];
  for (const routine of due) {
    // Claim it first. If the run throws, or the function is killed halfway, the
    // routine has already moved on rather than being retried forever.
    const next = advance(routine, now.getTime());
    const { error } = await db()
      .from("routines")
      .update({ next_run_at: next, last_run_at: now.toISOString() })
      .eq("id", routine.id)
      // Only if nothing else has claimed it since. Two overlapping sweeps then
      // land on one winner rather than both running it.
      .eq("next_run_at", routine.next_run_at);

    if (error) {
      console.error(`[cron] couldn't claim ${routine.id}: ${error.message}`);
      continue;
    }

    try {
      const result = await runRoutine(routine);
      results.push({ id: routine.id, name: routine.name, status: result.status, ms: result.ms });
    } catch (err) {
      // runRoutine files its own failures; this is the belt-and-braces case
      // where it threw before it could.
      console.error(`[cron] ${routine.name} threw: ${err?.message || err}`);
      results.push({ id: routine.id, name: routine.name, status: "failed" });
    }
  }

  return json(res, 200, {
    at: now.toISOString(),
    due: due.length,
    ran: results.length,
    // Only counts and names. What a routine asked and what came back is the
    // person's, and this endpoint's logs are not theirs.
    results
  });
}

/**
 * Vercel signs its own cron calls with CRON_SECRET as a bearer token. Anything
 * else is refused: this endpoint spends money on the account's behalf, so an
 * open one is a way for a stranger to run up the bill.
 *
 * With no secret set it accepts Vercel's own header only, which is present on
 * platform-issued cron invocations and absent on public requests.
 */
export function authorised(req, env = process.env) {
  const secret = env.CRON_SECRET;
  const auth = req.headers?.authorization || req.headers?.Authorization || "";

  if (secret) return auth === `Bearer ${secret}`;
  return Boolean(req.headers?.["x-vercel-cron"]);
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}
