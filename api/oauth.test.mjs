// The OAuth route has one job that must not be got wrong: deciding whose
// account a returning browser is allowed to attach a connection to.
//
// The return leg is a plain redirect from the provider. It carries no session,
// so the only thing linking it to a person is the state cookie written when the
// flow started — which means forging that cookie is the same as taking over
// someone's connections. These tests are mostly about that.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key-long-enough-to-sign-with";

const { sign, verify } = await import("./oauth.js");
const {
  PROVIDERS,
  catalogue,
  clientIdEnv,
  clientSecretEnv,
  isConfigured,
  missingFor,
  providerById
} = await import("./_catalogue.js");

/* ---------------------------------- state -------------------------------- */

test("a claim survives a round trip", () => {
  const claim = { p: "github", u: "user-1", n: "nonce", t: 1_700_000_000_000 };
  assert.deepEqual(verify(sign(claim)), claim);
});

test("a tampered claim is refused", () => {
  const honest = sign({ p: "github", u: "user-1", n: "nonce", t: 1 });

  // Swap the payload for one naming a different account, keeping the signature.
  const forged = Buffer.from(JSON.stringify({ p: "github", u: "user-2", n: "nonce", t: 1 }))
    .toString("base64url");
  assert.equal(verify(`${forged}.${honest.split(".")[1]}`), null);
});

test("a claim with no signature, a wrong one, or a truncated one is refused", () => {
  const [body, mac] = sign({ p: "github", u: "user-1", n: "n", t: 1 }).split(".");
  assert.equal(verify(body), null, "no signature at all");
  assert.equal(verify(`${body}.`), null, "empty signature");
  assert.equal(verify(`${body}.${mac.slice(0, -1)}`), null, "one character short");
  assert.equal(verify(`${body}.${"a".repeat(mac.length)}`), null, "right length, wrong value");
  assert.equal(verify(""), null);
  assert.equal(verify(null), null);
});

test("a signature from a different secret is refused", () => {
  const claim = { p: "github", u: "user-1", n: "n", t: 1 };
  const mine = sign(claim);

  const was = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "a-different-key-entirely";
  const theirs = sign(claim);
  process.env.SUPABASE_SERVICE_ROLE_KEY = was;

  assert.notEqual(mine, theirs, "the secret must actually reach the signature");
  assert.equal(verify(theirs), null, "another deployment's cookie must not be accepted here");
});

/* -------------------------------- catalogue ------------------------------ */

test("every service is complete enough to attempt", () => {
  for (const p of PROVIDERS) {
    assert.ok(p.id && p.name && p.blurb, `${p.id}: needs a name and a description`);
    assert.match(p.token, /^https:\/\//, `${p.id}: token endpoint must be https`);
    assert.match(p.mcp, /^https:\/\//, `${p.id}: an MCP endpoint is what makes the token useful`);
    assert.ok(p.register, `${p.id}: must say where to register an app`);
    assert.ok(["form", "json"].includes(p.exchange.style), `${p.id}: unknown exchange style`);
    assert.ok(["body", "basic"].includes(p.exchange.auth), `${p.id}: unknown credential placement`);
  }
});

test("service ids are unique — they key the one-row-per-service index", () => {
  const ids = PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("a service is only offered once everything it needs is set", () => {
  const github = providerById("github");
  assert.equal(isConfigured(github, {}), false, "nothing set");
  assert.deepEqual(missingFor(github, {}), ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]);

  assert.equal(isConfigured(github, { GITHUB_CLIENT_ID: "a" }), false, "half set is not set");
  assert.equal(isConfigured(github, { GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b" }), true);
});

test("a service with extra requirements says so", () => {
  const vercel = providerById("vercel");
  const half = { VERCEL_CLIENT_ID: "a", VERCEL_CLIENT_SECRET: "b" };
  assert.deepEqual(missingFor(vercel, half), ["VERCEL_INTEGRATION_SLUG"]);
  assert.equal(isConfigured(vercel, { ...half, VERCEL_INTEGRATION_SLUG: "selflight" }), true);
});

test("variable names are derived, not typed twice", () => {
  assert.equal(clientIdEnv("github"), "GITHUB_CLIENT_ID");
  assert.equal(clientSecretEnv("google-drive"), "GOOGLE_DRIVE_CLIENT_SECRET");
});

test("the browser is told what's missing but never a secret", () => {
  const listed = catalogue({ GITHUB_CLIENT_ID: "public-id", GITHUB_CLIENT_SECRET: "s3cret" });
  const serialised = JSON.stringify(listed);

  assert.ok(!serialised.includes("s3cret"), "a client secret must never be serialised to a browser");
  assert.ok(!serialised.includes("public-id"), "nor the id — the browser has no use for it");

  const github = listed.find((s) => s.id === "github");
  assert.equal(github.ready, true);
  assert.deepEqual(github.missing, []);

  // And an unconfigured one names its variables, which is the whole point.
  const linear = listed.find((s) => s.id === "linear");
  assert.equal(linear.ready, false);
  assert.deepEqual(linear.missing, ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET"]);
});

test("no service points at an MCP endpoint another one also claims", () => {
  const urls = PROVIDERS.map((p) => p.mcp);
  assert.equal(new Set(urls).size, urls.length);
});
