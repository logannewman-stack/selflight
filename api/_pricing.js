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

/* -------------------------------- credits -------------------------------- */

// Which model answers, and what it costs the person asking.
//
// One dial does both jobs. The Quick/Balanced/Deep control already existed and
// already reached the model — it just set the *effort* level and left every
// request on the same model, so "quick" cost the same as "deep" and the setting
// was, financially, decoration. Now it picks the model too.
//
// Credits are the unit people are billed in, and the weights are set so a
// credit costs roughly the same whatever it's spent on. That is the whole point
// of the design: without it, an account that only uses Deep costs three and a
// half times more than one that only uses Quick, on the same allowance.
export const MODELS = {
  quick: "claude-haiku-4-5",
  balanced: "claude-sonnet-5",
  deep: "claude-opus-5"
};

// Measured, not guessed: at ~4,600 tokens a message and a 40% search rate, a
// message costs 1.0¢ / 2.3¢ / 3.6¢ on the three models. Charging 1 / 2 / 3
// credits puts the cost of a credit at 1.0¢ / 1.15¢ / 1.20¢ — flat enough that
// the allowance means the same thing everywhere, and tilted just far enough
// that the dearest model is never the cheapest way to spend one.
// pricing.test.mjs holds these weights to that, so a rate change that breaks
// the relationship fails a test rather than quietly eating the margin.
export const CREDITS = { quick: 1, balanced: 2, deep: 3 };

// What a plan's allowance is quoted in. A "message" on the pricing page means a
// Balanced one, because that's what the app does by default.
export const CREDITS_PER_MESSAGE = CREDITS.balanced;

export const DEFAULT_DEPTH = "balanced";

// Not every model in MODELS takes the same request shape. Haiku 4.5 predates
// adaptive thinking and the effort parameter, and sending either returns a 400
// — so routing Quick there without this gate would have failed every single
// Quick request. The 5-series models all take both.
const NO_EFFORT = new Set(["claude-haiku-4-5"]);

/** Whether this model accepts `output_config.effort` and adaptive thinking. */
export function supportsEffort(model) {
  return !NO_EFFORT.has(String(model || "").trim());
}

// The dated web tools come in two shapes. The `_20260209` and later versions
// run the search or fetch *inside* code execution so the results can be
// filtered before they reach the context window — which is why they default
// `allowed_callers` to `["code_execution_20260120"]`, and why a model that
// can't call tools programmatically rejects them with a 400 telling you to set
// `allowed_callers: ["direct"]`.
//
// Anthropic documents dynamic filtering as Claude 4.6 and later. Haiku 4.5
// predates it, so the Quick tier was sending a tool shape its model has no way
// to run. The basic versions below are the ones that work there.
const NO_DYNAMIC_FILTERING = new Set(["claude-haiku-4-5"]);

/** Whether this model can run web search and fetch through code execution. */
export function supportsDynamicFiltering(model) {
  return !NO_DYNAMIC_FILTERING.has(String(model || "").trim());
}

/**
 * The web tool versions this model actually accepts.
 *
 * Two facts kept together on purpose: a model that can't do dynamic filtering
 * needs the older *pair*, and mixing them — a dated search with a basic fetch —
 * is a 400 on one of the two rather than on both, which is the confusing half
 * of this bug.
 */
export function webToolsFor(model) {
  return supportsDynamicFiltering(model)
    ? { search: "web_search_20260209", fetch: "web_fetch_20260209" }
    : { search: "web_search_20250305", fetch: "web_fetch_20250910" };
}

/** The depth to actually run at — a plan that doesn't include Deep can't ask for it. */
export function depthFor(settings = {}, plan = null) {
  const asked = MODELS[settings.depth] ? settings.depth : DEFAULT_DEPTH;
  if (asked === "deep" && plan && plan.deep === false) return DEFAULT_DEPTH;
  return asked;
}

/** Which model answers this turn. */
export function modelFor(settings = {}, plan = null) {
  return MODELS[depthFor(settings, plan)];
}

/** What this turn costs the person, in credits. */
export function creditsFor(settings = {}, plan = null) {
  return CREDITS[depthFor(settings, plan)];
}

/** Credits charged for one message on a given model — the reverse lookup. */
export function creditsForModel(model) {
  const depth = Object.keys(MODELS).find((d) => MODELS[d] === model);
  return depth ? CREDITS[depth] : CREDITS.balanced;
}

/* --------------------------------- plans --------------------------------- */

// ~4,600 billed tokens per turn on a mid-length thread — the figure the whole
// cost model in supabase/README.md is built on.
export const TOKENS_PER_MESSAGE = 4600;

// Allowances are set in messages because that is the only unit anybody reasons
// in, and stored in credits because that is what the server can actually count.
const messages = (n) => n * CREDITS_PER_MESSAGE;

/**
 * What someone gets, and what it costs us at the ceiling.
 *
 * The ceiling is not the expected cost — it's the worst case, and the gap
 * between them is the whole business. A typical account uses a fraction of its
 * allowance, so blended margin runs far above the figures marginOf() reports;
 * the cap exists so one scripted account can never make a month negative.
 *
 * `deep: false` locks the most expensive model out of a plan. On the free plan
 * that is what keeps a signup from costing $2.41, and it gives the upgrade a
 * reason to exist beyond a bigger number.
 */
export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    credits: messages(100),
    deep: false,
    connectors: 0,
    blurb: "100 messages a month. Enough to find out whether you like it."
  },
  starter: {
    id: "starter",
    name: "Starter",
    priceCents: 1999,
    credits: messages(250),
    deep: true,
    connectors: 8,
    blurb: "250 messages, connected accounts, and the deepest model when you need it."
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceCents: 5000,
    // 650, not 500. At 500 this tier charges 10¢ a message against Starter's
    // 8¢ — two Starter plans would be cheaper for the same allowance, so the
    // tier is one somebody works out not to buy. Every step up the ladder has
    // to be better value per message than the step below it, which is what the
    // ladder test in pricing.test.mjs enforces.
    credits: messages(650),
    deep: true,
    connectors: 16,
    blurb: "650 messages for people who use this every day."
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 10000,
    // 1,400 rather than 1,250: at 1,250 this tier works out at 8.0¢ a message
    // against Plus's 7.7¢, so the ladder stops descending and the bigger plan
    // is the worse deal. Each rung has to reward going up.
    credits: messages(1400),
    deep: true,
    connectors: 24,
    blurb: "1,400 messages. Built for work that runs all day."
  },
  max: {
    id: "max",
    name: "Max",
    priceCents: 20000,
    // Same reason: 3,000 keeps the per-message price falling (6.7¢).
    credits: messages(3000),
    deep: true,
    connectors: 48,
    blurb: "3,000 messages and every limit lifted as far as it goes."
  },
  byok: {
    id: "byok",
    name: "Bring your own key",
    priceCents: 1000,
    // No allowance: they're spending their own money, and a limit on somebody
    // else's budget is a limit that only annoys.
    credits: 0,
    deep: true,
    connectors: 48,
    blurb: "Your own Anthropic key. You pay the model; we charge for the app."
  }
};

export const PLAN_IDS = Object.keys(PLANS);

export function planFor(id) {
  return PLANS[String(id || "").trim()] || PLANS.free;
}

/** A plan's allowance in messages, for anything a person reads. */
export function messagesIn(plan) {
  const { credits } = planFor(plan.id || plan);
  return credits ? credits / CREDITS_PER_MESSAGE : 0;
}

/**
 * The number that decides everything: what one seat is worth at the margin.
 *
 * Worst case assumes every credit in the allowance is spent on the dearest
 * model the plan allows — the only assumption that can't be wrong in the
 * direction that hurts.
 */
export function marginOf(plan, model) {
  const resolved = planFor(plan.id || plan);
  const { priceCents, credits } = resolved;
  const revenue = priceCents * 10_000;

  if (!credits) {
    // Bring-your-own-key: the tokens aren't ours, so the margin is the price.
    return { revenue, worstCost: 0, margin: revenue, ratio: revenue ? 1 : 0 };
  }

  // The dearest model this plan can actually reach. A plan with Deep locked off
  // must not be costed as though its users could reach Opus.
  const dearest = model || (resolved.deep === false ? MODELS.balanced : MODELS.deep);
  const perMessage = creditsForModel(dearest);
  const count = credits / perMessage;
  const tokens = count * TOKENS_PER_MESSAGE;

  const worstCost =
    costOf({ model: dearest, input: tokens * 0.9, output: tokens * 0.1, searched: false }) +
    Math.round(count * rateFor(dearest).search);

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
