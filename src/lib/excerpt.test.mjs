// A search result you can read without opening the chat.
//
//   node --test src/lib/excerpt.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { excerpt } from "./excerpt.js";

const LONG =
  "I spent the morning trying to work out why the deployment kept failing and it " +
  "turned out the environment variable was set in preview but not in production, " +
  "which is the kind of thing that costs an hour.";

test("a short message is shown whole", () => {
  assert.equal(excerpt("Short enough already.", "short"), "Short enough already.");
});

test("whitespace is flattened, so a snippet is one line", () => {
  assert.equal(excerpt("two\n\n  lines   here", "lines"), "two lines here");
});

test("the phrase you searched for is in the result", () => {
  // The whole point. A snippet that doesn't contain the match tells you nothing
  // about whether this is the chat you wanted.
  const out = excerpt(LONG, "production");
  assert.ok(out.toLowerCase().includes("production"), `"${out}" doesn't contain the match`);
});

test("a match near the end is still shown", () => {
  const out = excerpt(LONG, "costs an hour");
  assert.ok(out.includes("costs an hour"), out);
});

test("a match at the very start doesn't get an opening ellipsis", () => {
  const out = excerpt(LONG, "I spent");
  assert.ok(out.startsWith("I spent"), out);
});

test("the result stays near the width it was asked for", () => {
  // Two ellipses and a trimmed word, so a little over is fine; twice over is a
  // sidebar row that wraps to four lines.
  const out = excerpt(LONG, "production", 60);
  assert.ok(out.length <= 70, `${out.length} characters is too long: "${out}"`);
});

test("no match still returns something readable", () => {
  // The database stems — searching "run" matches a message containing only
  // "running", so the literal phrase isn't always there to centre on.
  const out = excerpt(LONG, "nowhere-in-here");
  assert.ok(out.startsWith("I spent the morning"), out);
  assert.ok(out.endsWith("…"), "a truncated snippet should say it was truncated");
});

test("matching is case insensitive", () => {
  assert.ok(excerpt(LONG, "PRODUCTION").toLowerCase().includes("production"));
});

test("empty and missing text don't throw", () => {
  assert.equal(excerpt("", "x"), "");
  assert.equal(excerpt(null, "x"), "");
  assert.equal(excerpt(undefined, undefined), "");
});

test("an empty needle falls back to the opening rather than matching at 0", () => {
  // "".indexOf() returns 0, which would look like a match at the start and
  // silently change the meaning of the result.
  const out = excerpt(LONG, "");
  assert.ok(out.startsWith("I spent the morning"), out);
});

test("a cut never leaves a stray half word at the front", () => {
  const out = excerpt(LONG, "environment");
  const first = out.replace(/^…/, "").split(" ")[0];
  assert.ok(
    LONG.split(/\s+/).includes(first),
    `"${first}" is half a word — the cut landed mid-token`
  );
});
