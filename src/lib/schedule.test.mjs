// When a routine fires, and whether it fires twice.
//
//   node --test src/lib/schedule.test.mjs
//
// The scheduler reads next_run_at and nothing else, so everything about whether
// a routine is trustworthy lives in this file. Two failure modes matter more
// than the rest: firing twice for one slot (the person gets the same briefing
// again, and pays for it), and never firing at all (silence, which looks
// identical to a routine that was never set up).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CADENCES,
  describe as sentence,
  instantOf,
  localZone,
  nextRun,
  parseTime,
  timeLabel,
  validZone,
  whenLabel
} from "./schedule.js";

const utc = (s) => new Date(s).getTime();
// What the clock reads in a zone, as a string, so assertions are readable.
const clockIn = (ts, zone) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })
    .format(ts)
    .replace(",", "");

/* -------------------------------- the zone -------------------------------- */

test("a wall time resolves to the right instant in a fixed-offset zone", () => {
  // 08:00 UTC is 08:00Z.
  assert.equal(instantOf({ year: 2026, month: 3, day: 10, hour: 8 }, "UTC"), utc("2026-03-10T08:00:00Z"));
});

test("and in a zone that is behind", () => {
  // New York in March is UTC-4 (already on daylight time by the 10th).
  assert.equal(
    instantOf({ year: 2026, month: 3, day: 10, hour: 8 }, "America/New_York"),
    utc("2026-03-10T12:00:00Z")
  );
});

test("and in a zone that is ahead", () => {
  assert.equal(
    instantOf({ year: 2026, month: 6, day: 10, hour: 9 }, "Asia/Tokyo"),
    utc("2026-06-10T00:00:00Z")
  );
});

test("8am stays 8am across a daylight-saving change", () => {
  // London goes to BST on 29 March 2026. Both of these must read 08:00 locally,
  // which means they are an hour apart in UTC.
  const before = instantOf({ year: 2026, month: 3, day: 20, hour: 8 }, "Europe/London");
  const after = instantOf({ year: 2026, month: 4, day: 10, hour: 8 }, "Europe/London");

  assert.equal(clockIn(before, "Europe/London"), "20/03/2026 08:00");
  assert.equal(clockIn(after, "Europe/London"), "10/04/2026 08:00");
  assert.equal(new Date(before).getUTCHours(), 8, "GMT: 08:00 local is 08:00 UTC");
  assert.equal(new Date(after).getUTCHours(), 7, "BST: 08:00 local is 07:00 UTC");
});

test("an unknown zone is rejected rather than silently becoming UTC somewhere else", () => {
  assert.equal(validZone("Europe/London"), true);
  assert.equal(validZone("Mars/Olympus"), false);
  assert.equal(validZone(""), false);
});

test("the local zone is a real one", () => {
  assert.equal(validZone(localZone()), true);
});

/* ------------------------------- every hour ------------------------------- */

test("hourly lands on the next occurrence of that minute", () => {
  const at = nextRun({ every: "hour", atMinute: 15, zone: "UTC" }, utc("2026-05-01T09:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-01T09:15:00.000Z");
});

test("hourly rolls to the next hour once the minute has passed", () => {
  const at = nextRun({ every: "hour", atMinute: 15, zone: "UTC" }, utc("2026-05-01T09:15:00Z"));
  assert.equal(at.toISOString(), "2026-05-01T10:15:00.000Z");
});

test("hourly uses only the minutes of a time past an hour", () => {
  // 08:30 stored as 510 minutes means "at half past", not "at 8:30 only".
  const at = nextRun({ every: "hour", atMinute: 510, zone: "UTC" }, utc("2026-05-01T09:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-01T09:30:00.000Z");
});

/* -------------------------------- every day ------------------------------- */

test("daily fires later the same day when the time hasn't passed", () => {
  const at = nextRun({ every: "day", atMinute: 8 * 60, zone: "UTC" }, utc("2026-05-01T06:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-01T08:00:00.000Z");
});

test("daily rolls to tomorrow once it has", () => {
  const at = nextRun({ every: "day", atMinute: 8 * 60, zone: "UTC" }, utc("2026-05-01T09:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-02T08:00:00.000Z");
});

test("daily respects the routine's own zone", () => {
  const at = nextRun(
    { every: "day", atMinute: 8 * 60, zone: "America/New_York" },
    utc("2026-05-01T06:00:00Z")
  );
  assert.equal(clockIn(at.getTime(), "America/New_York"), "01/05/2026 08:00");
});

test("a daily routine in a zone a day ahead doesn't skip a day", () => {
  // 09:00 in Tokyo on the 2nd is 00:00Z on the 2nd; from 23:00Z on the 1st the
  // next one is an hour away, not 25.
  const at = nextRun({ every: "day", atMinute: 9 * 60, zone: "Asia/Tokyo" }, utc("2026-05-01T23:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-02T00:00:00.000Z");
});

/* ------------------------------ every weekday ----------------------------- */

test("weekdays skip the weekend", () => {
  // 2026-05-01 is a Friday. From Friday evening the next is Monday.
  const at = nextRun({ every: "weekday", atMinute: 8 * 60, zone: "UTC" }, utc("2026-05-01T09:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-04T08:00:00.000Z");
  assert.equal(at.getUTCDay(), 1, "Monday");
});

test("weekdays run on a Tuesday like any other", () => {
  const at = nextRun({ every: "weekday", atMinute: 8 * 60, zone: "UTC" }, utc("2026-05-05T06:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-05T08:00:00.000Z");
});

/* ------------------------------- every week ------------------------------- */

test("weekly lands on the chosen day", () => {
  // 2 = Tuesday.
  const at = nextRun({ every: "week", weekday: 2, atMinute: 9 * 60, zone: "UTC" }, utc("2026-05-01T09:00:00Z"));
  assert.equal(at.getUTCDay(), 2);
  assert.equal(at.toISOString(), "2026-05-05T09:00:00.000Z");
});

test("weekly on today, before the time, is today", () => {
  const at = nextRun({ every: "week", weekday: 5, atMinute: 9 * 60, zone: "UTC" }, utc("2026-05-01T06:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-01T09:00:00.000Z");
});

test("weekly on today, after the time, is next week", () => {
  const at = nextRun({ every: "week", weekday: 5, atMinute: 9 * 60, zone: "UTC" }, utc("2026-05-01T10:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-08T09:00:00.000Z");
});

/* ------------------------------ every month ------------------------------- */

test("monthly lands on the chosen date", () => {
  const at = nextRun({ every: "month", dayOfMonth: 15, atMinute: 7 * 60, zone: "UTC" }, utc("2026-05-01T00:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-15T07:00:00.000Z");
});

test("monthly rolls into the next month", () => {
  const at = nextRun({ every: "month", dayOfMonth: 15, atMinute: 7 * 60, zone: "UTC" }, utc("2026-05-20T00:00:00Z"));
  assert.equal(at.toISOString(), "2026-06-15T07:00:00.000Z");
});

test("monthly crosses a February without skipping it", () => {
  // The schema caps day_of_month at 28 precisely so this can never be skipped.
  const at = nextRun({ every: "month", dayOfMonth: 28, atMinute: 7 * 60, zone: "UTC" }, utc("2026-02-01T00:00:00Z"));
  assert.equal(at.toISOString(), "2026-02-28T07:00:00.000Z");
});

/* ------------------------- the two that really matter --------------------- */

test("a routine is never due again at the instant it just ran", () => {
  // The scheduler stamps next_run_at from the moment it fired. If that came
  // back equal rather than later, the next sweep would fire it again — the same
  // briefing twice, billed twice.
  const fired = utc("2026-05-01T08:00:00Z");
  for (const every of ["hour", "day", "weekday", "week", "month"]) {
    const at = nextRun({ every, atMinute: 8 * 60, weekday: 5, dayOfMonth: 1, zone: "UTC" }, fired);
    assert.ok(at.getTime() > fired, `${every} returned ${at.toISOString()}, which is not after it ran`);
  }
});

test("stepping a routine forward repeatedly never stalls or repeats", () => {
  // A year of daily runs, each computed from the last. Any duplicate or
  // backwards step is a routine that either spams or stops.
  let at = utc("2026-01-01T00:00:00Z");
  const seen = new Set();

  for (let i = 0; i < 365; i++) {
    const next = nextRun({ every: "day", atMinute: 8 * 60, zone: "Europe/London" }, at);
    assert.ok(next, `stopped producing a next run after ${i} steps`);
    assert.ok(next.getTime() > at, "went backwards or stood still");
    assert.ok(!seen.has(next.getTime()), "produced the same instant twice");
    seen.add(next.getTime());
    at = next.getTime();
  }

  // 365 daily runs should be about a year later, not 365 hours.
  const days = (at - utc("2026-01-01T00:00:00Z")) / 86_400_000;
  assert.ok(days > 363 && days < 367, `${days} days elapsed over 365 runs`);
});

test("every scheduled run reads as the chosen wall-clock time, DST or not", () => {
  // The whole reason zones are stored by name. Across a full year of daily 08:00
  // runs in London, every single one has to read 08:00 locally.
  let at = utc("2026-01-01T00:00:00Z");
  for (let i = 0; i < 365; i++) {
    const next = nextRun({ every: "day", atMinute: 8 * 60, zone: "Europe/London" }, at);
    assert.match(clockIn(next.getTime(), "Europe/London"), /08:00$/, `run ${i} drifted`);
    at = next.getTime();
  }
});

test("a cadence nobody knows about returns null rather than a date that never comes", () => {
  assert.equal(nextRun({ every: "fortnight", atMinute: 0, zone: "UTC" }, Date.now()), null);
  assert.equal(nextRun({}, Date.now()), null);
  assert.equal(nextRun(null, Date.now()), null);
});

test("an unknown zone falls back to UTC instead of failing", () => {
  const at = nextRun({ every: "day", atMinute: 8 * 60, zone: "Mars/Olympus" }, utc("2026-05-01T06:00:00Z"));
  assert.equal(at.toISOString(), "2026-05-01T08:00:00.000Z");
});

test("a nonsense time is clamped, not thrown", () => {
  assert.ok(nextRun({ every: "day", atMinute: 99999, zone: "UTC" }, Date.now()));
  assert.ok(nextRun({ every: "day", atMinute: -5, zone: "UTC" }, Date.now()));
  assert.ok(nextRun({ every: "day", atMinute: "eight", zone: "UTC" }, Date.now()));
});

/* --------------------------------- wording -------------------------------- */

test("times read the way people write them", () => {
  assert.equal(timeLabel(0), "00:00");
  assert.equal(timeLabel(8 * 60), "08:00");
  assert.equal(timeLabel(13 * 60 + 5), "13:05");
  assert.equal(timeLabel(1439), "23:59");
});

test("times parse back", () => {
  assert.equal(parseTime("08:00"), 480);
  assert.equal(parseTime("8:00"), 480);
  assert.equal(parseTime("23:59"), 1439);
  assert.equal(parseTime("24:00"), null);
  assert.equal(parseTime("08:60"), null);
  assert.equal(parseTime("rubbish"), null);
  assert.equal(parseTime(""), null);
});

test("a routine describes itself in a sentence", () => {
  assert.equal(sentence({ every: "day", atMinute: 480 }), "Every day at 08:00");
  assert.equal(sentence({ every: "weekday", atMinute: 540 }), "Every weekday at 09:00");
  assert.equal(sentence({ every: "week", weekday: 2, atMinute: 540 }), "Every Tuesday at 09:00");
  assert.match(sentence({ every: "month", dayOfMonth: 1, atMinute: 420 }), /^On the 1st of each month/);
  assert.match(sentence({ every: "month", dayOfMonth: 22, atMinute: 420 }), /^On the 22nd/);
  assert.match(sentence({ every: "hour", atMinute: 15 }), /^Every hour at 15 past/);
});

test("every cadence has a sentence, so none can render as a database row", () => {
  for (const cadence of CADENCES) {
    const said = sentence({ every: cadence.id, atMinute: 480, weekday: 1, dayOfMonth: 1 });
    assert.ok(said && !said.includes("undefined"), `${cadence.id} reads as "${said}"`);
  }
});

test("the next run reads as something you can picture", () => {
  const now = utc("2026-05-01T10:00:00Z");
  assert.equal(whenLabel(utc("2026-05-01T10:20:00Z"), "UTC", now), "in 20 min");
  assert.equal(whenLabel(utc("2026-05-01T18:00:00Z"), "UTC", now), "today at 18:00");
  assert.equal(whenLabel(utc("2026-05-02T08:00:00Z"), "UTC", now), "tomorrow at 08:00");
  assert.match(whenLabel(utc("2026-05-05T08:00:00Z"), "UTC", now), /^Tue at 08:00$/);
  assert.match(whenLabel(utc("2026-06-05T08:00:00Z"), "UTC", now), /^5\/6 at 08:00$/);
  assert.equal(whenLabel(null), "not scheduled");
  assert.equal(whenLabel("not a date"), "not scheduled");
});
