// What a reply costs, in money.
//
// usage_events has counted tokens since the beginning, and tokens are the wrong
// unit for every decision that matters. "4,600 tokens" doesn't tell you whether
// a plan is profitable, which tier to put someone on, or what a heavy user is
// worth. Cents do.
//
// Everything here is integers in **micro-dollars** — millionths of a dollar, so
// 2.4¢ is 24,000. Money in floats accumulates error, and a margin figure that
// drifts is worse than none.
//
// Rates checked August 2026. They move; `docs` is where to confirm each one.

export const RATES = {
  /* ------------------------------- Perplexity ------------------------------ */
  // Sonar bills twice: per token, and a per-request fee when a reply actually
  // searches. `search` is micro-dollars per request, so a $14-per-1,000 fee is
  // 14_000 — the first version of this file wrote 1_400 and understated every
  // reply by half. On these models the search fee is a third of the bill, which is
  // why `enable_search_classifier` is worth what it costs to set.
  sonar: { in: 1, out: 1, search: 5_000, name: "Sonar", docs: "perplexity" },
  "sonar-pro": { in: 3, out: 15, search: 10_000, name: "Sonar Pro", docs: "perplexity" },
  "sonar-reasoning-pro": { in: 2, out: 8, search: 14_000, name: "Sonar Reasoning Pro", docs: "perplexity" },

  /* -------------------------------- Anthropic ------------------------------ */
  // Sonnet 5 is on introductory pricing ($2/$10) until 2026-08-31. Deliberately
  // *not* encoded: a margin that quietly worsens on a date nobody remembers is
  // the worst kind of surprise. These are the standard rates, so the figures
  // are honest before the change and unchanged after it.
  "claude-opus-5": { in: 5, out: 25, search: 10_000, name: "Claude Opus 5", docs: "anthropic" },
  "claude-sonnet-5": { in: 3, out: 15, search: 10_000, name: "Claude Sonnet 5", docs: "anthropic" },
  "claude-haiku-4-5": { in: 1, out: 5, search: 10_000, name: "Claude Haiku 4.5", docs: "anthropic" }
};

// A model we don't have a rate for still has to cost *something*, or an
// unpriced model silently reports as free and every margin figure is wrong in
// the flattering direction. Priced as the dearest thing we know about.
const UNKNOWN = { in: 5, out: 25, search: 14_000, name: "unknown model", estimated: true };

export function rateFor(model) {
  return RATES[String(model || "").trim()] || UNKNOWN;
}

/**
 * What one model call cost, in micro-dollars.
 *
 * @param {object} call
 * @param {string} call.model
 * @param {number} call.input   input tokens
 * @param {number} call.output  output tokens
 * @param {boolean} [call.searched]  whether the reply paid a per-request search fee
 */
export function costOf({ model, input = 0, output = 0, searched = true }) {
  const rate = rateFor(model);

  // Rates are dollars per million tokens; a micro-dollar is a millionth of a
  // dollar. So dollars-per-million × tokens lands exactly on micro-dollars with
  // no scaling factor at all — which is the reason for choosing this unit.
  const tokens = rate.in * Math.max(0, input) + rate.out * Math.max(0, output);
  return Math.round(tokens + (searched ? rate.search : 0));
}

/* --------------------------------- plans --------------------------------- */

// Caps are in tokens because that's what the server can count mid-request, but
// they're *set* in messages because that's the only unit anyone reasons in.
// ~4,600 billed tokens per turn on a mid-length thread — the figure the whole
// cost model in supabase/README.md is built on.
export const TOKENS_PER_MESSAGE = 4600;

const messages = (n) => n * TOKENS_PER_MESSAGE;

/**
 * What someone gets, and what it costs us at the ceiling.
 *
 * The ceiling is not the expected cost — it's the worst case, and the gap
 * between them is the whole business. A tester sending 120 messages costs about
 * $3 against a cap that would allow $12, so blended margin on a $20 plan sits
 * near 85% while the cap keeps a runaway script from ever making it negative.
 *
 * `priceCents` is what to charge; 0 means free. `byok` plans use the person's
 * own API key, so they cost us nothing to serve and are priced for the software
 * rather than the tokens.
 */
export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    cap: messages(40),
    connectors: 0,
    blurb: "Enough to find out whether you like it."
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 2000,
    cap: messages(500),
    connectors: 8,
    blurb: "Daily use, connected accounts, and every colour control."
  },
  byok: {
    id: "byok",
    name: "Bring your own key",
    priceCents: 800,
    // No cap: they're spending their own money, and a limit on somebody else's
    // budget is a limit that only annoys.
    cap: 0,
    connectors: 8,
    blurb: "Your own Perplexity or Anthropic key. You pay the model; we charge for the app."
  },
  team: {
    id: "team",
    name: "Team",
    priceCents: 3000,
    // 600, not 1000: at 1000 the worst case leaves 13% margin, which is not a
    // circuit breaker — it's a plan that stops working the month somebody
    // scripts it. 30 messages a working day covers real use with room over.
    cap: messages(600),
    connectors: 16,
    blurb: "Per seat. Shared connectors and colour packages across the workspace."
  }
};

export const PLAN_IDS = Object.keys(PLANS);

export function planFor(id) {
  return PLANS[String(id || "").trim()] || PLANS.free;
}

/**
 * The number that decides everything: what one seat is worth at the margin.
 *
 * Returns micro-dollars of revenue, worst-case cost, and the margin between
 * them. Worst case assumes every token in the cap is spent on the most
 * expensive model configured — which is the only assumption that can't be
 * wrong in the direction that hurts.
 */
export function marginOf(plan, model = "sonar-reasoning-pro") {
  const { priceCents, cap } = planFor(plan.id || plan);
  const revenue = priceCents * 10_000; // cents → micro-dollars

  if (!cap) {
    // Bring-your-own-key: the tokens aren't ours, so the margin is the price.
    return { revenue, worstCost: 0, margin: revenue, ratio: revenue ? 1 : 0 };
  }

  // Split the cap the way real traffic splits: roughly 90% input on a thread
  // that resends its history every turn.
  const worstCost = costOf({
    model,
    input: cap * 0.9,
    output: cap * 0.1,
    searched: false
  }) + Math.round((cap / TOKENS_PER_MESSAGE) * rateFor(model).search);

  return {
    revenue,
    worstCost,
    margin: revenue - worstCost,
    ratio: revenue ? (revenue - worstCost) / revenue : 0
  };
}

/* ------------------------------- formatting ------------------------------ */

/** Micro-dollars as money, at the precision the number deserves. */
export function money(micros) {
  const dollars = micros / 1_000_000;
  if (dollars === 0) return "$0";
  if (dollars < 0.01) return `${(dollars * 100).toFixed(2)}¢`;
  if (dollars < 1) return `${(dollars * 100).toFixed(1)}¢`;
  if (dollars < 100) return `$${dollars.toFixed(2)}`;
  return `$${Math.round(dollars).toLocaleString()}`;
}
