// Start a subscription.
//
// The browser sends a plan id and nothing else that matters. The price, the
// amount, and the currency are all looked up here from environment variables —
// so a request that says "put me on Max" and a request that says "put me on Max
// for £0" are the same request, and both get Max's real price.
//
// It also returns a Customer Portal link, which is how somebody changes or
// cancels a plan. Stripe hosts that screen: card details, proration, invoices,
// cancellation and the dunning emails when a card expires are all theirs. The
// alternative is rebuilding a payments UI, badly, and holding card data.

import { billingFor, hasSupabase, saveStripeCustomer, userFromRequest } from "./_supabase.js";
import { configured, priceFor, purchasable, siteUrl, stripe } from "./_stripe.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  if (!configured()) {
    return json(res, 503, {
      error: "Payments aren't set up on this deployment yet. Add STRIPE_SECRET_KEY."
    });
  }

  if (!hasSupabase) {
    return json(res, 503, { error: "Subscriptions need an account, and accounts need Supabase." });
  }

  const user = await userFromRequest(req);
  if (!user) return json(res, 401, { error: "Sign in first." });

  let body = {};
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "Could not parse the request body." });
  }

  const returnTo = siteUrl(req);

  try {
    const customer = await customerFor(user);

    // Managing an existing subscription is the portal's job, not a second
    // checkout — a second checkout would open a second subscription and charge
    // them twice.
    if (body.action === "portal") {
      const session = await stripe().billingPortal.sessions.create({
        customer,
        return_url: `${returnTo}/?billing=done`
      });
      return json(res, 200, { url: session.url });
    }

    const plan = String(body.plan || "").trim();
    if (!purchasable(plan)) {
      // Says which, because "invalid plan" when the real cause is an unset
      // STRIPE_PRICE_PLUS is an afternoon nobody gets back.
      return json(res, 400, {
        error: `"${plan}" isn't a plan that can be bought here. Check its STRIPE_PRICE_* variable is set.`
      });
    }

    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceFor(plan), quantity: 1 }],
      // Both of these carry the account through to the webhook. The webhook
      // resolves identity from the customer id rather than trusting either, but
      // they make a payment traceable to an account in Stripe's own dashboard.
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id, plan } },
      metadata: { user_id: user.id, plan },
      success_url: `${returnTo}/?billing=success`,
      cancel_url: `${returnTo}/?billing=cancelled`,
      allow_promotion_codes: true
    });

    return json(res, 200, { url: session.url });
  } catch (err) {
    console.error(`[api/checkout] ${err?.stack || err}`);
    return json(res, 502, { error: "Couldn't reach Stripe. Try again in a moment." });
  }
}

/**
 * The Stripe customer for an account, created once and remembered.
 *
 * Reusing it is what keeps one person from accumulating a customer record per
 * checkout — which would scatter their invoices across several and make the
 * portal show only the most recent.
 */
async function customerFor(user) {
  const existing = await billingFor(user.id);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripe().customers.create({
    email: user.email || undefined,
    metadata: { user_id: user.id }
  });

  await saveStripeCustomer(user.id, customer.id);
  return customer.id;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
