// The mapping between money and entitlement.
//
// The webhook accepts requests from the open internet and is the only route in
// the app that changes what somebody is allowed to do. Everything asserted here
// is a way that goes wrong quietly: a price that maps to the wrong plan, an
// unknown price that resolves to the largest plan instead of none, a plan that
// can be bought without a configured price. None of them throw. They just
// hand somebody something they didn't pay for, or take something they did.
//
// The signature check itself is Stripe's code and isn't re-tested here. What is
// tested is that nothing downstream of it can be reached without it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLANS } from "./_pricing.js";
import { planForPrice, priceFor, purchasable, sellable, siteUrl } from "./_stripe.js";

const ENV = { ...process.env };

const withPrices = (prices, run) => {
  for (const [key, value] of Object.entries(prices)) process.env[key] = value;
  try {
    return run();
  } finally {
    for (const key of Object.keys(prices)) {
      if (ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ENV[key];
    }
  }
};

/* ------------------------- price to plan, and back ------------------------ */

test("a price maps to the plan it sells, and only that one", () => {
  withPrices(
    {
      STRIPE_PRICE_STARTER: "price_starter",
      STRIPE_PRICE_PLUS: "price_plus",
      STRIPE_PRICE_PRO: "price_pro",
      STRIPE_PRICE_MAX: "price_max"
    },
    () => {
      assert.equal(planForPrice("price_starter"), "starter");
      assert.equal(planForPrice("price_plus"), "plus");
      assert.equal(planForPrice("price_pro"), "pro");
      assert.equal(planForPrice("price_max"), "max");
    }
  );
});

test("an unrecognised price grants nothing, rather than the biggest plan", () => {
  // The shape of the bug worth preventing: a lookup that falls back to the
  // first or last entry hands a $200 plan to anybody who pays for anything.
  withPrices({ STRIPE_PRICE_STARTER: "price_starter" }, () => {
    assert.equal(planForPrice("price_from_another_account"), null);
    assert.equal(planForPrice(""), null);
    assert.equal(planForPrice(null), null);
    assert.equal(planForPrice(undefined), null);
  });
});

test("an unset price variable doesn't accidentally match an unset one", () => {
  // Both sides being undefined must not read as a match — that would make every
  // unknown price resolve to whichever plan was configured least.
  withPrices({}, () => {
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_MAX;
    assert.equal(planForPrice(undefined), null);
    assert.equal(planForPrice(""), null);
  });
});

test("a plan with no configured price can't be bought", () => {
  withPrices({ STRIPE_PRICE_STARTER: "price_starter" }, () => {
    delete process.env.STRIPE_PRICE_MAX;
    assert.equal(purchasable("starter"), true);
    assert.equal(purchasable("max"), false, "no price set means no checkout, not a free upgrade");
  });
});

test("free is never purchasable, however it's spelled", () => {
  // A £0 subscription would then have to be cancelled to leave, and downgrading
  // to free is a cancellation rather than a purchase.
  for (const attempt of ["free", "FREE", " free ", "", null, undefined, "nonsense"]) {
    assert.equal(purchasable(attempt), false, `"${attempt}" must not be purchasable`);
  }
});

test("the catalogue only offers what this deployment can actually sell", () => {
  withPrices({ STRIPE_PRICE_STARTER: "price_starter", STRIPE_PRICE_PRO: "price_pro" }, () => {
    delete process.env.STRIPE_PRICE_PLUS;
    delete process.env.STRIPE_PRICE_MAX;
    delete process.env.STRIPE_PRICE_BYOK;

    const ids = sellable().map((p) => p.id);
    assert.deepEqual(ids, ["starter", "pro"], "a plan with no price is not on sale");
    // And in price order, so the interface doesn't have to sort it.
    assert.ok(PLANS.starter.priceCents < PLANS.pro.priceCents);
  });
});

test("every paid plan has a price variable defined for it", () => {
  // Adding a plan to _pricing.js without a STRIPE_PRICE_* entry makes it
  // unsellable in a way nobody notices until somebody tries to buy it.
  for (const plan of Object.values(PLANS)) {
    if (!plan.priceCents) continue;
    withPrices({ [`STRIPE_PRICE_${plan.id.toUpperCase()}`]: "price_test" }, () => {
      assert.equal(
        priceFor(plan.id),
        "price_test",
        `${plan.id} has no STRIPE_PRICE_${plan.id.toUpperCase()} mapping in _stripe.js`
      );
    });
  }
});

/* ------------------------------ where we return --------------------------- */

test("the return URL follows the deployment, not a hardcoded host", () => {
  // A preview deployment that sends people back to production after paying is
  // a payment somebody makes against the wrong database.
  const previous = process.env.POLSTAR_SITE_URL;
  delete process.env.POLSTAR_SITE_URL;
  const previousVite = process.env.VITE_SITE_URL;
  delete process.env.VITE_SITE_URL;

  try {
    assert.equal(siteUrl({ headers: { host: "polstar-preview.vercel.app" } }), "https://polstar-preview.vercel.app");
    assert.equal(
      siteUrl({ headers: { "x-forwarded-host": "polstar.ai" } }),
      "https://polstar.ai",
      "the proxied host wins, because that's what the browser actually asked for"
    );
    assert.equal(siteUrl({ headers: {} }), "https://polstar.ai");
  } finally {
    if (previous !== undefined) process.env.POLSTAR_SITE_URL = previous;
    if (previousVite !== undefined) process.env.VITE_SITE_URL = previousVite;
  }
});

test("a trailing slash on the configured site URL doesn't double up", () => {
  const previous = process.env.POLSTAR_SITE_URL;
  process.env.POLSTAR_SITE_URL = "https://polstar.ai/";
  try {
    assert.equal(siteUrl({}), "https://polstar.ai", "otherwise every return URL is polstar.ai//?billing=…");
  } finally {
    if (previous === undefined) delete process.env.POLSTAR_SITE_URL;
    else process.env.POLSTAR_SITE_URL = previous;
  }
});

/* --------------------------- the webhook's guards ------------------------- */

const webhook = readFileSync(new URL("./stripe-webhook.js", import.meta.url), "utf8");

test("body parsing stays off, or every signature check fails", () => {
  // Stripe signs the bytes it sent. A parsed and re-serialised body is
  // different bytes, so the signature can never match — and the symptom is a
  // billing system that silently stops granting plans.
  assert.match(
    webhook,
    /bodyParser:\s*false/,
    "stripe-webhook.js must keep `config = { api: { bodyParser: false } }`"
  );
});

test("nothing is applied before the signature is verified", () => {
  // The ordering that matters: constructEvent() must appear before the first
  // call that touches an account.
  const verify = webhook.indexOf("constructEvent");
  const applies = webhook.indexOf("await apply(event)");

  assert.ok(verify > 0, "the webhook must verify the signature");
  assert.ok(applies > verify, "no event may be applied before its signature is checked");
});

test("a rejected signature returns without doing work", () => {
  const rejected = webhook.slice(webhook.indexOf("signature rejected"));
  const nextReturn = rejected.indexOf("return json(res, 400");
  assert.ok(nextReturn > 0 && nextReturn < 200, "a bad signature must return immediately");
});

test("identity comes from our own table, never from the payload", () => {
  // metadata.user_id is attacker-controlled on any request that isn't signed,
  // and pointless on one that is. The customer id looked up in profiles is the
  // only handle that can't be chosen.
  assert.match(webhook, /userIdForCustomer/, "the webhook must resolve the account from the customer id");
  assert.doesNotMatch(
    webhook,
    /metadata\??\.\s*user_id/,
    "the webhook must not read a user id out of event metadata"
  );
});

test("a failure to apply an event asks Stripe to retry rather than swallowing it", () => {
  // Returning 200 on a database error would drop somebody's plan change
  // permanently — Stripe considers a 2xx delivered and never sends it again.
  assert.match(webhook, /return json\(res, 500/, "an unapplied event must return 5xx so Stripe retries");
});
