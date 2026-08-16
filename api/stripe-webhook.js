// Where a payment becomes an entitlement.
//
// This is the only route in the app that changes what somebody is allowed to
// do, and it accepts requests from the open internet. Three things keep that
// from being a way to hand yourself the largest plan we sell:
//
//   1. Every delivery's signature is verified against the raw request bytes
//      with STRIPE_WEBHOOK_SECRET. An unverified body is never read, never
//      parsed, and never acted on — not even to log what it claimed.
//   2. Identity comes from the Stripe customer id, looked up in our own table.
//      Nothing in the payload chooses an account, so a forged user_id in
//      metadata changes nothing.
//   3. The plan comes from the price id on the subscription, mapped through
//      environment variables. An unrecognised price grants nothing.
//
// The failure mode worth naming: if body parsing is left on, the raw bytes are
// gone by the time this runs and every signature check fails. That must look
// like a loud error, not like a webhook that quietly stops working — a billing
// system that silently stops granting plans is one people notice through
// support tickets a fortnight later.

import { setPlan, userIdForCustomer } from "./_supabase.js";
import { configured, planForPrice, stripe } from "./_stripe.js";
import { record } from "./_failures.js";

// Stripe signs the bytes it sent. A parsed-and-reserialised body is different
// bytes — different key order, different whitespace — so the signature can
// never match. This must stay off.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  if (!configured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe] a webhook arrived but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET aren't set");
    return json(res, 503, { error: "Payments aren't configured here." });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) return json(res, 400, { error: "Unsigned." });

  let raw;
  try {
    raw = await rawBody(req);
  } catch (err) {
    console.error(`[stripe] could not read the request body: ${err?.message}`);
    return json(res, 400, { error: "Unreadable body." });
  }

  if (!raw.length) {
    // Almost always means body parsing is on and consumed the stream. Say so,
    // because "signature verification failed" sends people hunting for a wrong
    // secret they don't have.
    console.error(
      "[stripe] the request body was empty — body parsing is consuming the stream " +
        "before the signature can be checked. `export const config = { api: { bodyParser: false } }` " +
        "must stay in this file."
    );
    return json(res, 400, { error: "Empty body." });
  }

  let event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // The one branch that must never fall through to doing work.
    console.error(`[stripe] signature rejected: ${err?.message}`);
    return json(res, 400, { error: "Bad signature." });
  }

  try {
    await apply(event);
  } catch (err) {
    console.error(`[stripe] handling ${event.type}: ${err?.stack || err}`);
    await record({
      kind: "billing",
      severity: "error",
      summary: `Stripe ${event.type} could not be applied`,
      detail: err?.stack || String(err?.message || err),
      context: { event: event.id, type: event.type }
    }).catch(() => {});

    // A 500 makes Stripe retry, which is what we want for a transient database
    // failure. Returning 200 here would drop somebody's plan change forever.
    return json(res, 500, { error: "Could not apply the event." });
  }

  return json(res, 200, { received: true });
}

/* ------------------------------- the events ------------------------------ */

async function apply(event) {
  switch (event.type) {
    // Somebody finished checkout. The session names a subscription; the
    // subscription names the price; the price names the plan.
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription" || !session.subscription) return;
      const subscription = await stripe().subscriptions.retrieve(String(session.subscription));
      return grant(event, subscription);
    }

    // Upgrade, downgrade, renewal, or a cancellation scheduled for period end.
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return grant(event, event.data.object);

    // The subscription is over — not scheduled to end, over. Back to free.
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const userId = await userIdForCustomer(String(subscription.customer));
      if (!userId) return warnUnknown(subscription.customer, event);

      await setPlan(userId, "free", { subscriptionId: null, until: null, eventId: event.id });
      return;
    }

    // Worth knowing about, but not worth revoking a plan over: Stripe retries
    // the charge for days and emails them. Revoking on the first failure would
    // cut off somebody whose card simply expired.
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      await record({
        kind: "billing",
        severity: "degraded",
        summary: "A subscription payment failed",
        detail: `Invoice ${invoice.id} for customer ${invoice.customer} was not paid. Stripe will retry.`,
        context: { event: event.id, customer: String(invoice.customer || "") }
      }).catch(() => {});
      return;
    }

    default:
      // Everything else Stripe sends is fine to ignore, and ignoring it with a
      // 200 stops Stripe retrying it forever.
      return;
  }
}

/** Put the account behind a subscription onto the plan that subscription pays for. */
async function grant(event, subscription) {
  const userId = await userIdForCustomer(String(subscription.customer));
  if (!userId) return warnUnknown(subscription.customer, event);

  // A subscription that isn't paying for anything right now isn't an
  // entitlement. `past_due` deliberately keeps the plan — Stripe is still
  // retrying the card and will send `deleted` if it never succeeds.
  const live = ["active", "trialing", "past_due"].includes(subscription.status);
  if (!live) {
    await setPlan(userId, "free", { subscriptionId: null, until: null, eventId: event.id });
    return;
  }

  const item = subscription.items?.data?.[0];
  const plan = planForPrice(item?.price?.id);

  if (!plan) {
    // Somebody is paying for something this deployment can't map to a plan —
    // usually a STRIPE_PRICE_* variable that was never set, or set to the test
    // mode price while the key is live. Do not guess, and do not silently leave
    // them on free after they've paid.
    await record({
      kind: "billing",
      severity: "error",
      summary: "A paid subscription maps to no plan",
      detail:
        `Price ${item?.price?.id} on subscription ${subscription.id} matches no ` +
        `STRIPE_PRICE_* variable, so the customer has paid and been granted nothing. ` +
        `Check the price ids for this mode (test vs live).`,
      context: { event: event.id, price: String(item?.price?.id || "") }
    }).catch(() => {});
    return;
  }

  await setPlan(userId, plan, {
    subscriptionId: subscription.id,
    until: periodEnd(subscription),
    eventId: event.id
  });
}

/**
 * When the paid period runs out.
 *
 * Stripe moved this from the subscription onto its items, so both places are
 * read — a version bump that silently returned undefined here would show every
 * subscriber "your plan runs until —".
 */
function periodEnd(subscription) {
  const seconds =
    subscription.items?.data?.[0]?.current_period_end ?? subscription.current_period_end;
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

async function warnUnknown(customer, event) {
  console.error(`[stripe] no account for customer ${customer}`);
  await record({
    kind: "billing",
    severity: "error",
    summary: "A Stripe event named a customer with no account",
    detail:
      `Customer ${customer} has no row in profiles.stripe_customer_id, so ${event.type} ` +
      `could not be applied to anybody. Either checkout was started outside the app, or ` +
      `the customer was created against a different environment.`,
    context: { event: event.id, customer: String(customer || "") }
  }).catch(() => {});
}

/* ------------------------------- plumbing -------------------------------- */

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
