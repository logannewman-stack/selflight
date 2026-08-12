// Turning a database failure into something a person can act on.
//
// This exists because the failure it describes actually happened: the app
// gained columns after the database was created, every message read and write
// started failing, and the only sign was a console line nobody opens. Chats
// kept their titles and lost their contents.
//
//   node --test src/lib/store.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

const { explain } = await import("./faults.js");

test("a missing column names the file that adds it", () => {
  // What PostgREST returns when the app asks for a column the table lacks.
  const fault = explain("saving messages", {
    code: "PGRST204",
    message: "Could not find the 'thinking' column of 'messages' in the schema cache"
  });

  assert.match(fault.title, /missing a column/i);
  assert.match(fault.detail, /0002_repair\.sql/);
  assert.equal(fault.fatal, true, "nothing will save until this is fixed — it shouldn't scroll away");
});

test("the same fault by message rather than code", () => {
  const fault = explain("loading a conversation", {
    message: 'column messages.sources does not exist'
  });
  assert.match(fault.detail, /0002_repair\.sql/);
});

test("no tables at all points at the first migration, not the repair", () => {
  const fault = explain("loading chats", {
    code: "42P01",
    message: 'relation "public.chats" does not exist'
  });

  assert.match(fault.title, /hasn't been set up/i);
  assert.match(fault.detail, /0001_init\.sql/);
});

test("a policy refusal reads as a session problem, because that's what it usually is", () => {
  const fault = explain("saving messages", {
    code: "42501",
    message: "new row violates row-level security policy"
  });

  assert.match(fault.detail, /sign in/i);
  assert.equal(fault.fatal, false, "reloading may fix it, so it shouldn't be permanent");
});

test("anything unrecognised still says what was being done", () => {
  const fault = explain("saving settings", { message: "network timeout" });
  assert.match(fault.title, /saving settings/);
  assert.equal(fault.fatal, false);
});

test("no error is not a fault", () => {
  // fail() returns early on a null error; explain should never be reached with
  // one, but a fault object built from nothing would be worse than a crash.
  assert.ok(explain("x", { message: "" }).title);
});
