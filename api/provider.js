// Which model answers.
//
// Claude is the default. It's the only one that can call a connected account,
// and it's the one the Quick/Balanced/Deep dial routes across three models on
// — so the cost argument that used to favour Perplexity no longer holds: Quick
// runs on Haiku, which is cheaper per message than Sonar.
//
// Perplexity remains as a fallback for a deployment that only has that key.
// Setting both now keeps Claude. That order used to be reversed, on the
// reasoning that the cheaper provider should win by accident rather than the
// dearer one — which quietly meant that adding ANTHROPIC_API_KEY to a project
// that still had PERPLEXITY_API_KEY set changed nothing at all, with no error
// and no notice. Silence is the worst possible answer to "did my switch work".

import * as anthropic from "./providers/anthropic.js";
import * as perplexity from "./providers/perplexity.js";

export const PROVIDERS = [anthropic, perplexity];

export function provider() {
  return PROVIDERS.find((p) => p.configured()) || anthropic;
}

/**
 * The provider for a particular turn.
 *
 * Connectors are the exception to "cheapest wins". A connected GitHub account
 * is worth nothing if the model that answers can't call it, so a turn with an
 * active connector goes to a provider that supports tools when one is
 * configured, and the default keeps the rest of the traffic cheap.
 *
 * With only Perplexity set this changes nothing and returns it — the panel and
 * the notice on the reply both say the connector can't be reached, which is
 * better than routing to a model that isn't there.
 */
export function providerFor({ connectors = [] } = {}) {
  const active = connectors.filter((c) => c?.enabled !== false && c?.url);
  if (!active.length) return provider();

  const capable = PROVIDERS.find((p) => p.configured() && p.supportsConnectors);
  return capable || provider();
}

export function missingKey() {
  if (PROVIDERS.some((p) => p.configured())) return null;
  return (
    "No model API key is set. Add ANTHROPIC_API_KEY to your Vercel project's " +
    "environment variables, or to .env.local for local development. Get one at " +
    "console.anthropic.com under API keys."
  );
}

// The one message a person sees when something goes wrong that isn't their
// fault. Providers name what they can; everything else is the same to a reader.
export function userFacingError(err) {
  return (
    provider().describeError?.(err) || "Something went wrong reaching the model. Try again."
  );
}
