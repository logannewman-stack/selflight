// Two things here can be quietly wrong in ways nobody notices until the
// mailbox fills up.
//
// Fingerprinting: too loose and distinct bugs collapse into one row nobody
// looks at twice; too tight and one flapping connector files a ticket a minute
// all night. The tests pin both edges.
//
// The not-knowing detector: it decides what gets written down as a gap in the
// product. Firing on "I don't know why that happens, but here's what does"
// would fill the log with answers that were perfectly good.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key-long-enough-to-sign-with";

const { admittedNotKnowing, fingerprint, KINDS, SEVERITIES } = await import("./_failures.js");

/* ----------------------------- fingerprinting ---------------------------- */

const base = {
  kind: "connector",
  summary: "Claude failed to answer a chat turn",
  context: { provider: "Claude", route: "/api/chat" }
};

test("the same failure twice is one fingerprint", () => {
  const a = fingerprint({ ...base, detail: "connect ETIMEDOUT 10.0.0.1:443" });
  const b = fingerprint({ ...base, detail: "connect ETIMEDOUT 10.0.0.1:443" });
  assert.equal(a, b);
});

test("the same failure with different incidental numbers is still one", () => {
  // These are the same bug. Treating them as two is how a log becomes noise.
  const a = fingerprint({ ...base, detail: "request timed out after 30001ms" });
  const b = fingerprint({ ...base, detail: "request timed out after 30004ms" });
  assert.equal(a, b);
});

test("ids, urls and quoted strings don't split a fingerprint either", () => {
  const withId = (id) => `request ${id} failed`;
  assert.equal(
    fingerprint({ ...base, detail: withId("6f1c2a3b-1111-4222-8333-444455556666") }),
    fingerprint({ ...base, detail: withId("aaaabbbb-9999-4888-8777-666655554444") })
  );

  assert.equal(
    fingerprint({ ...base, detail: "GET https://a.example/x failed" }),
    fingerprint({ ...base, detail: "GET https://b.example/y failed" })
  );

  assert.equal(
    fingerprint({ ...base, detail: 'no tool named "list_repos"' }),
    fingerprint({ ...base, detail: 'no tool named "search_code"' })
  );
});

test("genuinely different failures stay apart", () => {
  const timeout = fingerprint({ ...base, detail: "connect ETIMEDOUT" });
  const refused = fingerprint({ ...base, detail: "connect ECONNREFUSED" });
  assert.notEqual(timeout, refused, "different errors");

  const other = fingerprint({ ...base, kind: "model", detail: "connect ETIMEDOUT" });
  assert.notEqual(timeout, other, "different kind of failure");

  const elsewhere = fingerprint({
    ...base,
    detail: "connect ETIMEDOUT",
    context: { provider: "Perplexity", route: "/api/chat" }
  });
  assert.notEqual(timeout, elsewhere, "different provider");
});

test("who it happened to never affects the fingerprint", () => {
  // Otherwise every user hitting one broken connector opens their own ticket.
  const one = fingerprint({ ...base, detail: "boom", userId: "user-a" });
  const two = fingerprint({ ...base, detail: "boom", userId: "user-b" });
  assert.equal(one, two);
});

test("a fingerprint is short, stable and hex", () => {
  const value = fingerprint({ ...base, detail: "boom" });
  assert.match(value, /^[0-9a-f]{32}$/);
});

test("the vocabularies are closed sets", () => {
  // Both are checked against these before insert, so a typo becomes 'unknown'
  // and 'error' rather than a row nothing will ever query.
  assert.deepEqual(KINDS, [
    "model",
    "connector",
    "store",
    "transcribe",
    "oauth",
    "unknown",
    "feedback"
  ]);
  assert.deepEqual(SEVERITIES, ["error", "degraded", "unknown", "reported"]);
});

test("the two entries that aren't bugs are in the vocabulary", () => {
  // 'unknown' is the assistant saying so, 'feedback' is a person saying so.
  // Both are evidence of a gap; neither is an exception. If either fell out of
  // these lists it would be silently rewritten to 'model'/'error' on insert and
  // land in the repair workflow as a crash that never happened.
  assert.ok(KINDS.includes("unknown"));
  assert.ok(KINDS.includes("feedback"));
  assert.ok(SEVERITIES.includes("reported"));
});

/* ------------------------------ not knowing ------------------------------ */

test("an admission is caught", () => {
  const admissions = [
    "I don't know. The documentation doesn't say.",
    "I don't know the answer to that one.",
    "I'm not sure whether that endpoint still exists.",
    "I'm not certain about the current pricing.",
    "I can't verify that from what I have.",
    "I don't have access to your repository.",
    "I'm unable to confirm that number."
  ];
  for (const text of admissions) {
    assert.ok(admittedNotKnowing(text), `should have been recorded: ${text}`);
  }
});

test("a confident answer that happens to contain the words is not", () => {
  const fine = [
    "I don't know why that happens, but here's what does: the cache is stale.",
    "Most people don't know this, but the flag defaults to true.",
    "You said you weren't sure about the syntax — it's two arguments, not three.",
    "If you don't know the project id, run `vercel projects ls`.",
    "The error means the server can't tell which branch you meant."
  ];
  for (const text of fine) {
    assert.equal(admittedNotKnowing(text), null, `should have been left alone: ${text}`);
  }
});

test("an admission is returned as the phrase, not the whole reply", () => {
  const found = admittedNotKnowing(
    "I don't know the answer to that. Here is what I'd check first, though, " +
      "and it's a long paragraph that has no business being in a failure log."
  );
  assert.ok(found.length < 60, `stored the whole reply: ${found}`);
  assert.match(found, /don'?t know/i);
});

test("nothing at all is not an admission", () => {
  assert.equal(admittedNotKnowing(""), null);
  assert.equal(admittedNotKnowing(null), null);
  assert.equal(admittedNotKnowing("ok"), null);
});

/* -------------------------------- the feed ------------------------------- */

test("the feed refuses a wrong secret, a missing one, and a prefix of the right one", async () => {
  const { authorised } = await import("./failures.js");
  const secret = "correct-horse-battery-staple";

  assert.equal(authorised({ headers: { "x-selflight-secret": secret } }, secret), true);
  assert.equal(authorised({ headers: {} }, secret), false);
  assert.equal(authorised({ headers: { "x-selflight-secret": "" } }, secret), false);
  assert.equal(authorised({ headers: { "x-selflight-secret": "wrong" } }, secret), false);
  // Hashing before comparing is what makes a length mismatch safe rather than
  // a thrown exception, and a prefix no more informative than any other guess.
  assert.equal(authorised({ headers: { "x-selflight-secret": secret.slice(0, -1) } }, secret), false);
  assert.equal(authorised({ headers: { "x-selflight-secret": `${secret}x` } }, secret), false);
});
