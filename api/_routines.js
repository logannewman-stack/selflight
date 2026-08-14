// What a routine is allowed to be, and what happens when one runs.
//
// Shared by the CRUD route and the scheduler so they can't disagree about
// validation — a routine the interface accepts and the scheduler then refuses
// is a routine that silently never runs.

import { db, hasSupabase } from "./_supabase.js";
import { nextRun } from "../src/lib/schedule.js";

export const CADENCES = ["hour", "day", "weekday", "week", "month"];
export const CHANNELS = ["chat", "email", "webhook"];

// Long enough for a real instruction, short enough that a routine can't quietly
// become the most expensive thing in the account.
export const MAX_PROMPT = 2000;
export const MAX_NAME = 80;

// Per account, so a loop that creates routines can't run the bill up. Well
// above what anyone sets up by hand.
export const MAX_ROUTINES = 40;

/**
 * Checks and normalises what came in, or says what's wrong with it.
 *
 * Returns `{ routine }` or `{ error }`. Never both, and never a routine with a
 * field the database would reject — the constraints in 0007 are the backstop,
 * not the first line of defence, because a constraint violation reaches the
 * person as "new row violates check constraint routines_minute_in_day".
 */
export function validate(input = {}, { partial = false } = {}) {
  const routine = {};

  const has = (key) => input[key] !== undefined;
  const need = (key) => !partial || has(key);

  if (need("name")) {
    const name = String(input.name ?? "").trim().slice(0, MAX_NAME);
    if (!name) return { error: "Give the routine a name." };
    routine.name = name;
  }

  if (need("prompt")) {
    const prompt = String(input.prompt ?? "").trim();
    if (!prompt) return { error: "Say what the routine should ask." };
    if (prompt.length > MAX_PROMPT) {
      return { error: `That instruction is ${prompt.length} characters; ${MAX_PROMPT} is the limit.` };
    }
    routine.prompt = prompt;
  }

  if (need("every")) {
    const every = String(input.every ?? "day");
    if (!CADENCES.includes(every)) {
      return { error: `"${every}" isn't a schedule. Pick one of ${CADENCES.join(", ")}.` };
    }
    routine.every = every;
  }

  if (has("atMinute") || need("atMinute")) {
    const at = Number(input.atMinute ?? 480);
    if (!Number.isInteger(at) || at < 0 || at > 1439) {
      return { error: "That time isn't a time of day." };
    }
    routine.at_minute = at;
  }

  if (has("weekday")) {
    const day = input.weekday === null ? null : Number(input.weekday);
    if (day !== null && (!Number.isInteger(day) || day < 0 || day > 6)) {
      return { error: "That isn't a day of the week." };
    }
    routine.weekday = day;
  }

  if (has("dayOfMonth")) {
    const day = input.dayOfMonth === null ? null : Number(input.dayOfMonth);
    // 1–28 only. The 30th would skip February entirely, and a monthly routine
    // that silently misses a month is worse than one that runs a day early.
    if (day !== null && (!Number.isInteger(day) || day < 1 || day > 28)) {
      return { error: "Pick a day from 1 to 28, so the routine never skips February." };
    }
    routine.day_of_month = day;
  }

  if (need("zone")) {
    const zone = String(input.zone || "UTC");
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    } catch {
      return { error: `"${zone}" isn't a time zone this server knows.` };
    }
    routine.zone = zone;
  }

  if (need("deliver")) {
    const wanted = Array.isArray(input.deliver) ? input.deliver : ["chat"];
    const clean = [...new Set(wanted.map(String))].filter((c) => CHANNELS.includes(c));
    if (!clean.length) {
      return { error: "The answer has to go somewhere — a chat, an email, or a webhook." };
    }
    routine.deliver = clean;

    if (clean.includes("email")) {
      const email = String(input.email ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return { error: "That doesn't look like an email address." };
      }
      routine.email = email;
    }

    if (clean.includes("webhook")) {
      const url = String(input.webhook ?? "").trim();
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return { error: "That webhook isn't a URL." };
      }
      // https only. A routine posts the model's answer, which is the person's
      // own content, and http would put it on the wire in the clear.
      if (parsed.protocol !== "https:") return { error: "The webhook has to be https." };
      routine.webhook = parsed.toString();
    }
  }

  if (has("enabled")) routine.enabled = Boolean(input.enabled);
  if (has("projectId")) routine.project_id = input.projectId || null;

  return { routine };
}

// The database row as the browser sees it. camelCase, and never anything the
// browser didn't already know.
export function toClient(row) {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    every: row.every,
    atMinute: row.at_minute,
    weekday: row.weekday,
    dayOfMonth: row.day_of_month,
    zone: row.zone,
    deliver: row.deliver || [],
    email: row.email || "",
    webhook: row.webhook || "",
    enabled: row.enabled,
    projectId: row.project_id || null,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at
  };
}

// The schedule a row implies, in the shape src/lib/schedule.js expects.
export function specOf(row) {
  return {
    every: row.every,
    atMinute: row.at_minute,
    weekday: row.weekday,
    dayOfMonth: row.day_of_month,
    zone: row.zone
  };
}

/**
 * Moves a routine's next run forward past `now`.
 *
 * Stepping from `now` rather than from the run it just missed matters when a
 * deployment has been down: a daily routine that missed a fortnight should run
 * once when it comes back, not fourteen times.
 */
export function advance(row, now = Date.now()) {
  const at = nextRun(specOf(row), now);
  return at ? at.toISOString() : null;
}

export async function dueNow(limit = 25, now = new Date()) {
  if (!hasSupabase) return [];

  const { data, error } = await db()
    .from("routines")
    .select("*")
    .eq("enabled", true)
    .not("next_run_at", "is", null)
    .lte("next_run_at", now.toISOString())
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error(`[routines] couldn't read what's due: ${error.message}`);
    return [];
  }
  return data || [];
}
