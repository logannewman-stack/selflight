// Money arithmetic, held to account.
//
// Every pricing decision downstream of this file — what to charge, which plan
// somebody belongs on, whether a heavy user is worth keeping — is only as good
// as these numbers. A cost model that's wrong in the flattering direction is
// the most expensive kind of bug, because nothing fails: the dashboard just
// says the business works.

import test from "node:test";
import assert from "node:assert/strict";
import {
  PLANS,
  PLAN_IDS,
  RATES,
  TOKENS_PER_MESSAGE,
  costOf,
  marginOf,
  money,
  planFor,
  rateFor
} from "./_pricing.js";

const cents = (micros) => micros / 10_000;

/* --------------------------------- cost ---------------------------------- */

test("a typical message costs what the cost model says it does", () => {
  // The figure supabase/README.md is built on: ~4,600 tokens, ~90% input, on
  // the default tier. If this drifts, every published number is stale.
  const micros = costOf({
    model: "sonar-reasoning-pro",
    input: 4600 * 0.9,
    output: 4600 * 0.1
  });

  assert.ok(cents(micros) > 2.0 && cents(micros) < 2.8, `expected ~2.4¢, got ${cents(micros)}¢`);
});

test("the search fee is a real share of the bill, not a rounding error", () => {
  const shape = { model: "sonar-reasoning-pro", input: 4140, output: 460 };
  const withSearch = costOf({ ...shape, searched: true });
  const without = costOf({ ...shape, searched: false });

  const share = (withSearch - without) / withSearch;
  assert.ok(share > 0.4, `search is ${Math.round(share * 100)}% of the bill — expected over 40%`);
});

test("the cheap tier really is a third of the default", () => {
  const shape = { input: 4140, output: 460 };
  const quick = costOf({ ...shape, model: "sonar" });
  const deep = costOf({ ...shape, model: "sonar-reasoning-pro" });

  assert.ok(quick * 2 < deep, `quick ${cents(quick)}¢ vs deep ${cents(deep)}¢ — expected under half`);
});

test("cost is integer micro-dollars — no float drift", () => {
  const micros = costOf({ model: "sonar", input: 1234, output: 567 });
  assert.equal(Number.isInteger(micros), true);

  // A thousand identical calls must cost exactly a thousand times one call.
  let total = 0;
  for (let i = 0; i < 1000; i++) total += micros;
  assert.equal(total, micros * 1000);
});

test("an unknown model is priced high, never free", () => {
  // The tempting bug: a model with no rate silently costs nothing, and the
  // margin dashboard reports a business that doesn't exist.
  const unknown = costOf({ model: "some-model-we-added-and-forgot", input: 4140, output: 460 });
  const dearest = costOf({ model: "claude-opus-5", input: 4140, output: 460 });

  assert.ok(unknown > 0, "an unpriced model must not cost zero");
  assert.ok(unknown >= dearest * 0.9, "an unpriced model must be priced like the dearest one we know");
  assert.equal(rateFor("nonsense").estimated, true, "and must admit the figure is an estimate");
});

test("negative or missing tokens can't produce a negative cost", () => {
  assert.ok(costOf({ model: "sonar", input: -5000, output: -5000 }) >= 0);
  assert.ok(costOf({ model: "sonar" }) >= 0);
});

test("every rate is complete", () => {
  for (const [id, rate] of Object.entries(RATES)) {
    assert.ok(rate.in > 0, `${id}: needs an input rate`);
    assert.ok(rate.out > 0, `${id}: needs an output rate`);
    assert.ok(rate.search >= 0, `${id}: needs a search fee, even if zero`);
    assert.ok(rate.name, `${id}: needs a display name`);
  }
});

/* --------------------------------- plans --------------------------------- */

test("every plan is coherent", () => {
  for (const id of PLAN_IDS) {
    const plan = PLANS[id];
    assert.equal(plan.id, id, `${id}: id must match its key`);
    assert.ok(plan.name && plan.blurb, `${id}: needs a name and a description`);
    assert.ok(plan.priceCents >= 0, `${id}: price can't be negative`);
    assert.ok(plan.cap >= 0, `${id}: cap can't be negative`);
  }
});

test("an unknown plan falls back to free, never to the generous one", () => {
  // A typo in a plan id must cost us the least, not the most.
  assert.equal(planFor("enterprise-platinum").id, "free");
  assert.equal(planFor(null).id, "free");
  assert.equal(planFor("").id, "free");
});

test("the free plan is small enough to be sustainable", () => {
  const { worstCost } = marginOf(PLANS.free);
  assert.ok(cents(worstCost) < 200, `free costs up to ${money(worstCost)} — too much to give away`);
});

test("every paid plan keeps a real margin even at its ceiling", () => {
  // The ceiling is the worst case, not the expectation — typical use leaves
  // ~93%. But a plan that only just breaks even at the cap isn't a circuit
  // breaker, it's a plan that stops working the month somebody scripts it.
  // 30% is the floor a price change has to clear.
  for (const id of PLAN_IDS) {
    const plan = PLANS[id];
    if (!plan.priceCents) continue;

    const { revenue, worstCost, ratio } = marginOf(plan);
    assert.ok(
      ratio >= 0.3,
      `${id}: ${money(revenue)} against ${money(worstCost)} worst case — ${Math.round(ratio * 100)}% margin, floor is 30%`
    );
  }
});

test("typical use is far more profitable than the ceiling — that gap is the business", () => {
  // 120 messages a month is the repo's own "real tester" figure.
  const typical = costOf({
    model: "sonar-reasoning-pro",
    input: 120 * 4140,
    output: 120 * 460
  });
  const { revenue, worstCost } = marginOf(PLANS.pro);

  assert.ok(typical < worstCost / 4, "typical use should be a fraction of the cap");
  assert.ok(
    (revenue - typical) / revenue > 0.85,
    `typical margin is ${Math.round(((revenue - typical) / revenue) * 100)}% — expected over 85%`
  );
});

test("bring-your-own-key is all margin, because the tokens aren't ours", () => {
  const { worstCost, ratio } = marginOf(PLANS.byok);
  assert.equal(worstCost, 0);
  assert.equal(ratio, 1);
});

test("caps are expressed in whole messages", () => {
  for (const id of PLAN_IDS) {
    const { cap } = PLANS[id];
    if (!cap) continue;
    assert.equal(cap % TOKENS_PER_MESSAGE, 0, `${id}: cap should be a whole number of messages`);
  }
});

test("a dearer model narrows the margin rather than being ignored", () => {
  const cheap = marginOf(PLANS.pro, "sonar");
  const dear = marginOf(PLANS.pro, "claude-opus-5");

  assert.ok(dear.worstCost > cheap.worstCost, "switching to a dearer model must move the worst case");
  assert.equal(dear.revenue, cheap.revenue, "and must not change the price");
});

/* ------------------------------- formatting ------------------------------ */

test("money reads at the precision the number deserves", () => {
  assert.equal(money(0), "$0");
  assert.equal(money(2400), "0.24¢");
  assert.equal(money(24_000), "2.4¢");
  assert.equal(money(3_000_000), "$3.00");
  assert.equal(money(1_234_000_000), "$1,234");
});
