// When does a routine run next?
//
// Shared by the browser (to show "next: tomorrow at 08:00") and the scheduler
// (to decide what is due), so both can never disagree about what a routine
// means. No dependencies — a date library would be four times the size of the
// app's own logic for this.
//
// Times are wall-clock in the routine's own zone, not offsets. Someone in
// London who asks for 8am wants 8am in March and 8am in July; storing +00:00
// would quietly become 9am for half the year, and a daily briefing arriving an
// hour late every summer is the sort of bug nobody reports and everybody
// notices.

export const CADENCES = [
  { id: "hour", name: "Every hour", needs: [] },
  { id: "day", name: "Every day", needs: ["time"] },
  { id: "weekday", name: "Every weekday", needs: ["time"] },
  { id: "week", name: "Every week", needs: ["time", "weekday"] },
  { id: "month", name: "Every month", needs: ["time", "day"] }
];

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/* ------------------------------ zone plumbing ----------------------------- */

// What the wall clock reads in `zone` at instant `ts`.
function partsIn(ts, zone) {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short"
  });

  const found = {};
  for (const { type, value } of format.formatToParts(ts)) found[type] = value;

  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // Midnight formats as "24" in some engines and "00" in others.
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(found.weekday)
  };
}

/**
 * The instant at which the clock in `zone` reads this wall time.
 *
 * Found by iteration rather than by a table of offsets: guess that the zone is
 * UTC, see what the clock actually says at that instant, and correct by the
 * difference. Two rounds converge everywhere, including across a DST boundary
 * where the first correction lands an hour out.
 */
export function instantOf({ year, month, day, hour = 0, minute = 0 }, zone) {
  let ts = Date.UTC(year, month - 1, day, hour, minute);

  for (let round = 0; round < 3; round++) {
    const clock = partsIn(ts, zone);
    const reads = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
    const offset = reads - ts;
    const next = Date.UTC(year, month - 1, day, hour, minute) - offset;
    if (next === ts) break;
    ts = next;
  }
  return ts;
}

export function validZone(zone) {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Whatever the browser is set to, falling back to UTC where that isn't
// available — a routine with no zone would otherwise run at a time nobody chose.
export function localZone() {
  const found = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return validZone(found) ? found : "UTC";
}

/* -------------------------------- the answer ------------------------------ */

function matches(routine, clock) {
  if (routine.every === "weekday") return clock.weekday >= 1 && clock.weekday <= 5;
  if (routine.every === "week") return clock.weekday === Number(routine.weekday ?? 1);
  if (routine.every === "month") return clock.day === Number(routine.dayOfMonth ?? 1);
  return true;
}

/**
 * The next time this routine should fire, strictly after `after`.
 *
 * Strictly: a routine that has just run must not be due again at the same
 * instant, or the scheduler picks it up on its next sweep and fires it twice.
 *
 * Returns null for a routine that can never fire — an unknown cadence, or a
 * zone this machine has never heard of — rather than a date that looks fine and
 * silently never comes.
 */
export function nextRun(routine, after = Date.now()) {
  const from = after instanceof Date ? after.getTime() : Number(after);
  if (!Number.isFinite(from)) return null;

  const cadence = CADENCES.find((c) => c.id === routine?.every);
  if (!cadence) return null;

  const zone = validZone(routine.zone) ? routine.zone : "UTC";
  const at = Number(routine.atMinute);
  const minute = Number.isFinite(at) ? Math.min(1439, Math.max(0, Math.trunc(at))) : 0;

  if (routine.every === "hour") {
    // Only the minutes matter. Land on the next occurrence of that minute past
    // the hour, and never on `from` itself.
    const past = minute % 60;
    const base = Math.floor(from / HOUR) * HOUR + past * MINUTE;
    return new Date(base > from ? base : base + HOUR);
  }

  const hour = Math.floor(minute / 60);
  const mins = minute % 60;

  // Walk forward a day at a time from today in the routine's own zone. 400 is
  // past any monthly gap, and bounded so a spec that can never match returns
  // null instead of spinning.
  const start = partsIn(from, zone);
  for (let step = 0; step < 400; step++) {
    const probe = partsIn(
      instantOf({ year: start.year, month: start.month, day: start.day, hour: 12 }, zone) + step * DAY,
      zone
    );
    if (!matches(routine, probe)) continue;

    const when = instantOf(
      { year: probe.year, month: probe.month, day: probe.day, hour, minute: mins },
      zone
    );
    if (when > from) return new Date(when);
  }
  return null;
}

/* --------------------------------- wording -------------------------------- */

export function timeLabel(atMinute) {
  const total = Number.isFinite(Number(atMinute)) ? Math.trunc(Number(atMinute)) : 0;
  const safe = Math.min(1439, Math.max(0, total));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function parseTime(text) {
  const found = /^(\d{1,2}):(\d{2})$/.exec(String(text || "").trim());
  if (!found) return null;
  const hour = Number(found[1]);
  const minute = Number(found[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

const ORDINAL = (n) => {
  const s = ["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th";
  return `${n}${s}`;
};

/**
 * The routine as a sentence.
 *
 * The interface shows this under the form as it's filled in, because "every:
 * week, weekday: 2, at_minute: 540" is a database row and "Every Tuesday at
 * 09:00" is something you can check at a glance and notice is wrong.
 */
export function describe(routine = {}) {
  const time = timeLabel(routine.atMinute);
  switch (routine.every) {
    case "hour":
      return `Every hour at ${String(Number(routine.atMinute || 0) % 60).padStart(2, "0")} past`;
    case "day":
      return `Every day at ${time}`;
    case "weekday":
      return `Every weekday at ${time}`;
    case "week":
      return `Every ${DAYS[Number(routine.weekday ?? 1)] || "Monday"} at ${time}`;
    case "month":
      return `On the ${ORDINAL(Number(routine.dayOfMonth ?? 1))} of each month at ${time}`;
    default:
      return "Only when you run it";
  }
}

// "in 4 minutes", "tomorrow at 08:00", "Tue at 09:00" — near things relative,
// far things absolute, because "in ­17 days" is not something anyone can picture.
export function whenLabel(at, zone = "UTC", now = Date.now()) {
  if (!at) return "not scheduled";
  const ts = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (!Number.isFinite(ts)) return "not scheduled";

  const away = ts - now;
  if (away <= 0) return "due now";
  if (away < HOUR) return `in ${Math.max(1, Math.round(away / MINUTE))} min`;

  const there = partsIn(ts, validZone(zone) ? zone : "UTC");
  const here = partsIn(now, validZone(zone) ? zone : "UTC");
  const clock = `${String(there.hour).padStart(2, "0")}:${String(there.minute).padStart(2, "0")}`;

  if (there.year === here.year && there.month === here.month && there.day === here.day) {
    return `today at ${clock}`;
  }
  if (away < 2 * DAY) return `tomorrow at ${clock}`;
  if (away < 7 * DAY) return `${DAYS[there.weekday].slice(0, 3)} at ${clock}`;
  return `${there.day}/${there.month} at ${clock}`;
}
