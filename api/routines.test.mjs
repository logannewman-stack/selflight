// What a routine is allowed to be, and who is allowed to run the scheduler.
//
//   node --test api/routines.test.mjs
//
// The scheduler spends money on somebody's behalf while nobody is watching, so
// two things are worth more than the rest: nothing invalid gets stored, and
// nothing but the platform can trigger a sweep.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CADENCES, CHANNELS, MAX_PROMPT, advance, specOf, toClient, validate } from "./_routines.js";
import { authorised } from "./cron.js";
import { firstLine } from "./_run.js";

const good = {
  name: "Morning brief",
  prompt: "What changed in AI overnight? Three bullets.",
  every: "weekday",
  atMinute: 480,
  zone: "Europe/London",
  deliver: ["chat"]
};

/* -------------------------------- the shape ------------------------------- */

test("a sensible routine is accepted and comes back in database shape", () => {
  const { routine, error } = validate(good);
  assert.equal(error, undefined);
  assert.equal(routine.name, "Morning brief");
  assert.equal(routine.at_minute, 480, "the column is snake_case; the browser's field isn't");
  assert.deepEqual(routine.deliver, ["chat"]);
});

test("a routine with no name is refused in words, not by the database", () => {
  // The constraints in 0007 are the backstop. Letting one fire reaches the
  // person as "new row violates check constraint", which is nobody's language.
  assert.match(validate({ ...good, name: "   " }).error, /name/i);
});

test("a routine with nothing to ask is refused", () => {
  assert.match(validate({ ...good, prompt: "" }).error, /ask/i);
});

test("an enormous prompt is refused with the numbers in it", () => {
  const { error } = validate({ ...good, prompt: "x".repeat(MAX_PROMPT + 1) });
  assert.match(error, new RegExp(String(MAX_PROMPT)));
  assert.match(error, /\d{4}/, "say how long it actually was");
});

test("a cadence nobody implements is refused, and lists the ones that exist", () => {
  const { error } = validate({ ...good, every: "fortnightly" });
  assert.match(error, /fortnightly/);
  for (const cadence of CADENCES) assert.ok(error.includes(cadence), `should offer ${cadence}`);
});

test("a time outside a day is refused", () => {
  assert.ok(validate({ ...good, atMinute: 1440 }).error);
  assert.ok(validate({ ...good, atMinute: -1 }).error);
  assert.ok(validate({ ...good, atMinute: 8.5 }).error);
  assert.equal(validate({ ...good, atMinute: 1439 }).error, undefined);
});

test("a day of the month past the 28th is refused, and says why", () => {
  // The 30th would skip February. A monthly routine that silently misses a
  // month is worse than one that runs two days early.
  const { error } = validate({ ...good, every: "month", dayOfMonth: 30 });
  assert.match(error, /February/i);
  assert.equal(validate({ ...good, every: "month", dayOfMonth: 28 }).error, undefined);
});

test("a made-up time zone is refused rather than becoming UTC", () => {
  assert.match(validate({ ...good, zone: "Mars/Olympus" }).error, /time zone/i);
  assert.equal(validate({ ...good, zone: "America/New_York" }).error, undefined);
});

/* ------------------------------- where it goes ---------------------------- */

test("an answer has to go somewhere", () => {
  assert.match(validate({ ...good, deliver: [] }).error, /somewhere/i);
  assert.match(validate({ ...good, deliver: ["carrier pigeon"] }).error, /somewhere/i);
});

test("every channel the interface offers is one the server accepts", () => {
  for (const channel of CHANNELS) {
    const extra =
      channel === "email"
        ? { email: "you@example.com" }
        : channel === "webhook"
          ? { webhook: "https://example.com/hook" }
          : {};
    assert.equal(validate({ ...good, deliver: [channel], ...extra }).error, undefined, channel);
  }
});

test("email delivery needs an address that looks like one", () => {
  assert.ok(validate({ ...good, deliver: ["email"] }).error);
  assert.ok(validate({ ...good, deliver: ["email"], email: "not an address" }).error);
  assert.equal(
    validate({ ...good, deliver: ["email"], email: "you@example.com" }).error,
    undefined
  );
});

test("a webhook has to be https", () => {
  // The body carries the model's answer, which is the person's own content.
  // http would put it on the wire in the clear.
  assert.match(validate({ ...good, deliver: ["webhook"], webhook: "http://x.com/h" }).error, /https/);
  assert.ok(validate({ ...good, deliver: ["webhook"], webhook: "not a url" }).error);
  assert.equal(
    validate({ ...good, deliver: ["webhook"], webhook: "https://x.com/h" }).error,
    undefined
  );
});

test("duplicate channels are collapsed rather than delivered twice", () => {
  const { routine } = validate({ ...good, deliver: ["chat", "chat", "chat"] });
  assert.deepEqual(routine.deliver, ["chat"]);
});

/* -------------------------------- editing --------------------------------- */

test("a partial change only carries what was sent", () => {
  const { routine, error } = validate({ enabled: false }, { partial: true });
  assert.equal(error, undefined);
  assert.deepEqual(Object.keys(routine), ["enabled"], "a rename shouldn't reset the schedule");
});

test("a partial change is still checked", () => {
  assert.ok(validate({ atMinute: 5000 }, { partial: true }).error);
  assert.ok(validate({ every: "never" }, { partial: true }).error);
});

/* ------------------------------- next run --------------------------------- */

test("advance moves a routine forward from now, not from the run it missed", () => {
  // A daily routine on a deployment that was down for a fortnight should run
  // once when it comes back, not fourteen times.
  const row = { every: "day", at_minute: 480, zone: "UTC" };
  const missedFor = Date.UTC(2026, 4, 15, 9, 0);

  const next = new Date(advance(row, missedFor));
  assert.equal(next.toISOString(), "2026-05-16T08:00:00.000Z");
});

test("advance returns null for a routine that can never fire", () => {
  assert.equal(advance({ every: "whenever", at_minute: 0, zone: "UTC" }, Date.now()), null);
});

test("specOf renames the columns the schedule library expects", () => {
  const spec = specOf({ every: "week", at_minute: 540, weekday: 2, day_of_month: null, zone: "UTC" });
  assert.deepEqual(spec, { every: "week", atMinute: 540, weekday: 2, dayOfMonth: null, zone: "UTC" });
});

test("toClient never leaks a column the browser has no business seeing", () => {
  const row = {
    id: "r1",
    user_id: "u1",
    name: "n",
    prompt: "p",
    every: "day",
    at_minute: 480,
    weekday: null,
    day_of_month: null,
    zone: "UTC",
    deliver: ["chat"],
    email: null,
    webhook: null,
    enabled: true,
    project_id: null,
    next_run_at: "2026-05-01T08:00:00Z",
    last_run_at: null,
    created_at: "2026-01-01T00:00:00Z"
  };

  const out = toClient(row);
  assert.equal(out.userId, undefined);
  assert.equal(out.user_id, undefined);
  assert.equal(out.atMinute, 480);
  assert.equal(out.nextRunAt, "2026-05-01T08:00:00Z");
});

/* ---------------------------- who may run a sweep ------------------------- */

test("a secret, when set, is the only way in", () => {
  const env = { CRON_SECRET: "s3cret" };
  assert.equal(authorised({ headers: { authorization: "Bearer s3cret" } }, env), true);
  assert.equal(authorised({ headers: { authorization: "Bearer wrong" } }, env), false);
  assert.equal(authorised({ headers: {} }, env), false);
  // The platform header must not be a way around a secret that was set.
  assert.equal(authorised({ headers: { "x-vercel-cron": "1" } }, env), false);
});

test("with no secret, only the platform's own header gets in", () => {
  assert.equal(authorised({ headers: { "x-vercel-cron": "1" } }, {}), true);
  assert.equal(authorised({ headers: {} }, {}), false);
  assert.equal(authorised({ headers: { authorization: "Bearer anything" } }, {}), false);
});

test("a request with no headers at all doesn't throw", () => {
  assert.equal(authorised({}, {}), false);
  assert.equal(authorised({}, { CRON_SECRET: "x" }), false);
});

/* --------------------------------- summary -------------------------------- */

test("a run's summary is one readable line", () => {
  assert.equal(firstLine("# Heading\n\nThe answer."), "Heading The answer.");
  assert.equal(firstLine("  spaced   out  "), "spaced out");
  assert.equal(firstLine(""), "");
  assert.equal(firstLine(null), "");
});

test("a long answer is cut to something a list can show", () => {
  const summary = firstLine("word ".repeat(200));
  assert.ok(summary.length <= 161, `${summary.length} characters is not a summary`);
  assert.ok(summary.endsWith("…"));
});
