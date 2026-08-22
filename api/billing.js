// What somebody's subscription is, and what's left of this month.
//
// Read-only. Nothing here changes a plan — that only ever happens in the Stripe
// webhook, from a signed payload. This route exists so the billing screen can
// show the truth without the browser having to work anything out, and so the
// figure it shows is the same figure the chat route enforces against.

import { billingFor, hasSupabase, usageThisMonth, userFromRequest } from "./_supabase.js";
import { CREDITS_PER_MESSAGE, messagesIn, money } from "./_pricing.js";
import { configured, priceFor, sellable } from "./_stripe.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed." });

  // The catalogue is the same for everyone and isn't secret, so it answers even
  // signed out — that's what lets a pricing page render before anybody has an
  // account.
  const catalogue = {
    payments: configured(),
    creditsPerMessage: CREDITS_PER_MESSAGE,
    // What a message costs at each depth is deliberately absent. It used to be
    // here, and the billing screen published a table of it. The per-depth
    // weighting is a pricing decision, and sending it to the browser puts it in
    // front of anyone who opens the network tab whether or not the screen draws
    // it — so taking the table out without taking this out would have hidden it
    // rather than withheld it.
    plans: sellable().map(describe)
  };

  if (!hasSupabase) return json(res, 200, { ...catalogue, plan: null });

  const user = await userFromRequest(req);
  if (!user) return json(res, 200, { ...catalogue, plan: null });

  const [usage, billing] = await Promise.all([usageThisMonth(user.id), billingFor(user.id)]);

  return json(res, 200, {
    ...catalogue,
    plan: {
      ...describe(usage.plan),
      // Everything below is about this account rather than the plan itself.
      used: usage.used,
      remaining: usage.cap ? Math.max(0, usage.cap - usage.used) : null,
      messagesLeft: usage.messages === Infinity ? null : usage.messages,
      exceeded: usage.exceeded,
      since: billing?.plan_since || null,
      until: billing?.plan_until || null,
      // Whether there is a subscription to manage. Drives whether the screen
      // offers "Change plan" or a row of prices.
      subscribed: Boolean(billing?.stripe_subscription_id)
    }
  });
}

/**
 * A plan, as the interface needs it.
 *
 * `priced` is whether this deployment can actually sell it. A plan with no
 * STRIPE_PRICE_* set renders as "not available" rather than as a button that
 * fails after the click.
 */
function describe(plan) {
  return {
    id: plan.id,
    name: plan.name,
    blurb: plan.blurb,
    priceCents: plan.priceCents,
    price: plan.priceCents ? money(plan.priceCents * 10_000) : "Free",
    messages: messagesIn(plan) || null,
    credits: plan.credits || null,
    connectors: plan.connectors,
    deep: plan.deep !== false,
    priced: Boolean(priceFor(plan.id))
  };
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    // Never cached: it's per-account and it's the number somebody is checking
    // because they think it's wrong.
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}
