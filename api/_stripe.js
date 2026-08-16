// Stripe, and the one mapping that decides who gets what.
//
// The rule this file exists to enforce: a plan is only ever decided by Stripe,
// never by the browser. The checkout route takes a plan *id* and looks up the
// price here; the webhook takes a price id from Stripe's own signed payload and
// looks up the plan here. Neither ever reads a price, an amount, or a plan name
// out of a request body — a browser that says "put me on Max for $0" is asking
// a question this code has no way to answer.

import Stripe from "stripe";
import { PLANS, planFor } from "./_pricing.js";

export const keyName = "STRIPE_SECRET_KEY";

export const configured = () => Boolean(process.env.STRIPE_SECRET_KEY);

// Which Stripe price sells which plan. One environment variable per paid plan,
// so prices can differ between test mode and live mode without a code change —
// and so a plan with no price configured simply can't be bought, rather than
// half-working.
const PRICE_ENV = {
  starter: "STRIPE_PRICE_STARTER",
  plus: "STRIPE_PRICE_PLUS",
  pro: "STRIPE_PRICE_PRO",
  max: "STRIPE_PRICE_MAX",
  byok: "STRIPE_PRICE_BYOK"
};

let client;

export function stripe() {
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

/** The Stripe price that sells a plan, or null if it isn't for sale here. */
export function priceFor(planId) {
  const name = PRICE_ENV[String(planId || "").trim()];
  if (!name) return null;
  const price = process.env[name];
  return price ? price.trim() : null;
}

/**
 * The plan a Stripe price sells.
 *
 * Unknown prices resolve to free, not to the generous plan. A price id we don't
 * recognise means somebody bought something this deployment doesn't know about,
 * and the safe reading of that is "no entitlement" — the alternative is that a
 * stale or mistyped environment variable hands out the largest plan we sell.
 */
export function planForPrice(priceId) {
  const id = String(priceId || "").trim();
  if (!id) return null;

  for (const planId of Object.keys(PRICE_ENV)) {
    if (priceFor(planId) === id) return planId;
  }
  return null;
}

/** The plans that can actually be bought on this deployment, in price order. */
export function sellable() {
  return Object.values(PLANS)
    .filter((plan) => plan.priceCents > 0 && priceFor(plan.id))
    .sort((a, b) => a.priceCents - b.priceCents);
}

/**
 * Whether a plan id is one somebody may check out.
 *
 * `free` is deliberately not purchasable: it's what you get by not paying, and
 * a checkout session for it would be a £0 subscription that then has to be
 * cancelled to leave. Downgrading to free is a cancellation, not a purchase.
 */
export function purchasable(planId) {
  const id = String(planId || "").trim();
  return Boolean(PRICE_ENV[id]) && planFor(id).id === id && Boolean(priceFor(id));
}

/** Where Stripe sends people back to. */
export function siteUrl(req) {
  const configuredUrl = process.env.POLSTAR_SITE_URL || process.env.VITE_SITE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/+$/, "");

  // Vercel sets this on every deployment, so previews return to themselves
  // rather than to production.
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  if (host) return `https://${String(host).split(",")[0].trim()}`;

  return "https://polstar.ai";
}
