// What the billing route is allowed to tell a browser.
//
// The per-depth weighting — that a Deep message is charged three credits where
// a Quick one is charged one — is a pricing decision, not a fact about the
// account. It used to be in this payload so the billing screen could publish a
// table of it. It isn't any more.
//
// This is a test rather than a deleted line because of how the mistake comes
// back: somebody removes the table from the screen and considers it done. The
// field keeps shipping, the network tab still has it, and nothing anywhere
// looks wrong. So the assertion is about the response, not the component — the
// one place it can be checked once instead of in every screen that might one
// day render it.

import test from "node:test";
import assert from "node:assert/strict";
import handler from "./billing.js";
import { MODELS } from "./_pricing.js";

// The catalogue only lists plans this deployment can actually sell, which means
// no price ids, no plans, and every loop below iterating over nothing. The first
// draft of this file did exactly that and reported three passes for checking
// none of them — so the ids come first, and each loop asserts it had something
// to look at.
for (const name of [
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_PLUS",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_MAX"
]) {
  process.env[name] = `price_test_${name.toLowerCase()}`;
}

// Signed out, with no Supabase configured: the catalogue on its own. That's the
// half everybody is served identically, and the half the removed field was in.
async function payload() {
  let body = null;
  const res = {
    writeHead() {},
    end(text) {
      body = JSON.parse(text);
    }
  };
  await handler({ method: "GET", headers: {} }, res);
  return body;
}

test("the catalogue still answers, signed out", async () => {
  const found = await payload();
  assert.ok(Array.isArray(found.plans) && found.plans.length > 0, "no plans to show");
  assert.equal(found.plan, null, "there's no account here to describe");
});

// Anywhere in the payload, a key named after a depth whose value is a number.
//
// The first version of this banned the depth names outright and failed on
// `deep: false` — the flag that says whether a plan includes the Deep setting,
// which is a feature of what somebody is buying and belongs on the screen. A
// check that fails on correct code gets deleted by the next person to see it,
// and takes the real guard with it. What's actually being kept out is a
// *quantity* attached to a depth.
function costsByDepth(value, key = null, found = []) {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) costsByDepth(v, k, found);
  } else if (key && key in MODELS && typeof value === "number") {
    found.push(`${key}: ${value}`);
  }
  return found;
}

test("no per-depth cost reaches the browser", async () => {
  const found = await payload();
  assert.equal(found.depths, undefined, "the depths table is back in the payload");

  // Not just that one key — a rename is the likeliest way this comes back.
  assert.deepEqual(
    costsByDepth(found),
    [],
    "a number is attached to a depth name somewhere in the payload"
  );
});

test("that check would notice if the table came back", () => {
  // Proving the walker rather than trusting it, since an always-empty result
  // is indistinguishable from a clean payload.
  assert.deepEqual(costsByDepth({ plans: [{ id: "pro", deep: true }] }), [], "false positive");
  assert.deepEqual(costsByDepth({ depths: [{ deep: 3 }] }), ["deep: 3"], "missed a nested cost");
  assert.deepEqual(costsByDepth({ credits: { quick: 1 } }), ["quick: 1"], "missed a renamed table");
});

test("plans are quoted in messages, with no per-depth figure riding along", async () => {
  // Allowances are still published: somebody buying a plan has to know what
  // they're getting. What's withheld is how fast the meter runs at each depth.
  const plans = (await payload()).plans;
  assert.ok(plans.length > 0, "no plans to check — this check proved nothing");

  for (const plan of plans) {
    assert.ok("messages" in plan, `${plan.id}: an allowance nobody can see isn't an offer`);
    assert.equal(plan.depths, undefined, `${plan.id}: carries a per-depth table`);
    assert.equal(plan.perDepth, undefined, `${plan.id}: carries a per-depth table`);
  }
});

test("a model name never appears in what's sent", async () => {
  // The other half of the same disclosure. Which model backs which depth is a
  // supplier decision that has already changed twice; publishing it invites
  // "why am I paying for Opus" about a tier that is no longer Opus.
  const text = JSON.stringify(await payload());
  const models = Object.values(MODELS);
  assert.ok(models.length > 0, "no models to look for — this check proved nothing");

  for (const model of models) {
    assert.ok(!text.includes(model), `${model} is named in the billing payload`);
  }
});
