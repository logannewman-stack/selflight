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
  CREDITS,
  CREDITS_PER_MESSAGE,
  MODELS,
  PLANS,
  PLAN_IDS,
  RATES,
  TOKENS_PER_MESSAGE,
  costOf,
  creditsFor,
  creditsForModel,
  depthFor,
  marginOf,
  messagesIn,
  modelFor,
  money,
  planFor,
  rateFor,
  supportsEffort
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
    assert.ok(plan.credits >= 0, `${id}: allowance can't be negative`);
  }
});

test("an unknown plan falls back to free, never to the generous one", () => {
  // A typo in a plan id must cost us the least, not the most.
  assert.equal(planFor("enterprise-platinum").id, "free");
  assert.equal(planFor(null).id, "free");
  assert.equal(planFor("").id, "free");
});

/* -------------------------------- credits -------------------------------- */

test("a credit costs about the same whichever model it buys", () => {
  // The whole reason credits exist. If Deep were the cheapest way to spend one,
  // every account would drift to the dearest model on the same allowance and
  // the plan economics would quietly invert.
  const perCredit = {};
  for (const [depth, model] of Object.entries(MODELS)) {
    const message =
      costOf({ model, input: TOKENS_PER_MESSAGE * 0.9, output: TOKENS_PER_MESSAGE * 0.1, searched: false }) +
      Math.round(rateFor(model).search * 0.4);
    perCredit[depth] = message / CREDITS[depth];
  }

  const values = Object.values(perCredit);
  const spread = Math.max(...values) / Math.min(...values);
  assert.ok(
    spread < 1.5,
    `a credit costs ${JSON.stringify(perCredit)} — spread of ${spread.toFixed(2)}x, expected under 1.5x`
  );

  // And the dearest model must never be the best value per credit, or the
  // weighting is an incentive to use it.
  assert.ok(
    perCredit.deep >= perCredit.quick,
    `deep is ${perCredit.deep.toFixed(0)} per credit vs quick's ${perCredit.quick.toFixed(0)} — deep must not be the bargain`
  );
});

test("a dearer depth costs more credits, in order", () => {
  assert.ok(CREDITS.quick < CREDITS.balanced, "balanced must cost more than quick");
  assert.ok(CREDITS.balanced < CREDITS.deep, "deep must cost more than balanced");
});

test("the depth dial actually changes the model", () => {
  // It used to change only the effort level, leaving every request on the same
  // model — so "quick" and "deep" cost identical money and the setting was,
  // financially, decoration.
  const picked = new Set(["quick", "balanced", "deep"].map((depth) => modelFor({ depth })));
  assert.equal(picked.size, 3, "each depth must reach a different model");
});

test("an unknown depth falls back to balanced, not to the dearest", () => {
  assert.equal(depthFor({ depth: "ludicrous" }), "balanced");
  assert.equal(depthFor({}), "balanced");
  assert.equal(modelFor({ depth: undefined }), MODELS.balanced);
  assert.equal(creditsFor({ depth: null }), CREDITS.balanced);
});

test("a plan without Deep can't be charged for it", () => {
  const free = PLANS.free;
  assert.equal(free.deep, false, "the free plan is the one that locks Deep off");
  assert.equal(modelFor({ depth: "deep" }, free), MODELS.balanced);
  assert.equal(creditsFor({ depth: "deep" }, free), CREDITS.balanced);

  // And a paid plan still gets it.
  assert.equal(modelFor({ depth: "deep" }, PLANS.starter), MODELS.deep);
});

test("credits map back from a model id, so a recorded row can be priced", () => {
  for (const [depth, model] of Object.entries(MODELS)) {
    assert.equal(creditsForModel(model), CREDITS[depth], `${model} should map back to ${depth}`);
  }
  // An unrecognised model must not be free.
  assert.ok(creditsForModel("something-we-added-and-forgot") > 0);
});

test("the models that reject the effort parameter are gated", () => {
  // Haiku 4.5 predates adaptive thinking and `effort`; sending either is a 400.
  // Routing Quick there without this gate fails every Quick request.
  assert.equal(supportsEffort("claude-haiku-4-5"), false);
  assert.equal(supportsEffort(MODELS.balanced), true);
  assert.equal(supportsEffort(MODELS.deep), true);
});

/* ------------------------------- the ladder ------------------------------ */

test("every paid plan keeps a real margin even at its ceiling", () => {
  // The ceiling is the worst case — every credit spent on the dearest model the
  // plan allows, every reply paying a search fee. Typical use runs far below it.
  // A plan that only just breaks even at the cap isn't a circuit breaker, it's
  // a plan that stops working the month somebody scripts it.
  for (const id of PLAN_IDS) {
    const plan = PLANS[id];
    if (!plan.priceCents) continue;

    const { revenue, worstCost, ratio } = marginOf(plan);
    assert.ok(
      ratio >= 0.5,
      `${id}: ${money(revenue)} against ${money(worstCost)} worst case — ${Math.round(ratio * 100)}% margin, floor is 50%`
    );
  }
});

test("each step up the ladder is better value per message than the one below", () => {
  // Otherwise a tier is one somebody works out not to buy: at $50 for 500
  // messages, two $19.99 plans were cheaper for the same allowance.
  const paid = PLAN_IDS.map((id) => PLANS[id])
    .filter((p) => p.priceCents > 0 && p.credits > 0)
    .sort((a, b) => a.priceCents - b.priceCents);

  for (let i = 1; i < paid.length; i++) {
    const below = paid[i - 1].priceCents / messagesIn(paid[i - 1]);
    const here = paid[i].priceCents / messagesIn(paid[i]);
    assert.ok(
      here <= below,
      `${paid[i].id} charges ${here.toFixed(1)}¢ a message against ${paid[i - 1].id}'s ${below.toFixed(1)}¢ — a higher tier must never cost more per message`
    );
  }
});

test("the free plan is bounded, and bounded by structure rather than by hope", () => {
  const { worstCost } = marginOf(PLANS.free);

  // A deliberate acquisition cost, stated rather than discovered: 100 messages
  // a month at the Balanced rate. Raise the allowance and this test is what
  // tells you what it now costs to give away.
  assert.ok(
    cents(worstCost) < 350,
    `free costs up to ${money(worstCost)} per signup — over the $3.50 that was signed off`
  );

  // The bound holds because Deep is locked off, not because we hope nobody
  // picks it. If that flag flips, the ceiling moves and this catches it.
  assert.equal(PLANS.free.deep, false);
});

test("typical use is far more profitable than the ceiling — that gap is the business", () => {
  // 120 messages a month is the repo's own "real tester" figure, at the mix a
  // real account uses rather than all-Deep.
  const typical =
    costOf({
      model: MODELS.balanced,
      input: 100 * TOKENS_PER_MESSAGE * 0.9,
      output: 100 * TOKENS_PER_MESSAGE * 0.1
    }) +
    costOf({
      model: MODELS.deep,
      input: 20 * TOKENS_PER_MESSAGE * 0.9,
      output: 20 * TOKENS_PER_MESSAGE * 0.1
    });

  const { revenue, worstCost } = marginOf(PLANS.starter);

  assert.ok(typical < worstCost, "typical use should sit below the cap");
  assert.ok(
    (revenue - typical) / revenue > 0.6,
    `typical margin is ${Math.round(((revenue - typical) / revenue) * 100)}% — expected over 60%`
  );
});

test("bring-your-own-key is all margin, because the tokens aren't ours", () => {
  const { worstCost, ratio } = marginOf(PLANS.byok);
  assert.equal(worstCost, 0);
  assert.equal(ratio, 1);
});

test("allowances are a whole number of messages", () => {
  for (const id of PLAN_IDS) {
    const { credits } = PLANS[id];
    if (!credits) continue;
    assert.equal(credits % CREDITS_PER_MESSAGE, 0, `${id}: allowance should be whole messages`);
    assert.equal(Number.isInteger(messagesIn(PLANS[id])), true);
  }
});

test("a dearer model costs more per message, in the order the credits say", () => {
  // Note this is per *message*, not per allowance. Under a credit system the
  // cheap model can have the higher ceiling — the same allowance buys 3x as
  // many Quick messages, and the flat per-search fee is charged on every one of
  // them. That's the credit weighting doing its job, not a bug, so the
  // invariant worth holding is the per-message ordering.
  const shape = { input: TOKENS_PER_MESSAGE * 0.9, output: TOKENS_PER_MESSAGE * 0.1 };
  const quick = costOf({ ...shape, model: MODELS.quick });
  const balanced = costOf({ ...shape, model: MODELS.balanced });
  const deep = costOf({ ...shape, model: MODELS.deep });

  assert.ok(quick < balanced && balanced < deep, `${quick} / ${balanced} / ${deep} out of order`);
});

test("the ceiling clears the margin floor on every model, not just the dearest", () => {
  // marginOf() costs a plan at the dearest model it allows, which is the right
  // default — but because the cheap model buys more messages per credit, the
  // worst case can live somewhere else entirely. Check all three.
  for (const id of PLAN_IDS) {
    const plan = PLANS[id];
    if (!plan.priceCents || !plan.credits) continue;

    for (const model of Object.values(MODELS)) {
      if (plan.deep === false && model === MODELS.deep) continue;
      const { revenue, worstCost, ratio } = marginOf(plan, model);
      assert.ok(
        ratio >= 0.5,
        `${id} on ${model}: ${money(revenue)} against ${money(worstCost)} — ${Math.round(ratio * 100)}%, floor is 50%`
      );
    }
  }
});

test("the free plan is bounded on every model it can reach", () => {
  for (const model of [MODELS.quick, MODELS.balanced]) {
    const { worstCost } = marginOf(PLANS.free, model);
    assert.ok(
      cents(worstCost) < 350,
      `free on ${model} costs up to ${money(worstCost)} per signup — over the $3.50 signed off`
    );
  }
});

/* ------------------------------- formatting ------------------------------ */

test("money reads at the precision the number deserves", () => {
  assert.equal(money(0), "$0");
  assert.equal(money(2400), "0.24¢");
  assert.equal(money(24_000), "2.4¢");
  assert.equal(money(3_000_000), "$3.00");
  assert.equal(money(1_234_000_000), "$1,234");
});
