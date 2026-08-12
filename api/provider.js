// Which model answers.
//
// Perplexity is the default: it searches the live web on every question that
// needs it, cites what it used, and costs a fraction of a frontier model.
// Setting ANTHROPIC_API_KEY instead switches to Claude, which is slower and
// dearer but supports MCP connectors and writes long enough replies for the
// Code workspace to build a real page.
//
// Setting both keeps Perplexity — an explicit choice, so the cheaper one wins
// by accident rather than the expensive one.

import * as perplexity from "./providers/perplexity.js";
import * as anthropic from "./providers/anthropic.js";

export const PROVIDERS = [perplexity, anthropic];

export function provider() {
  return PROVIDERS.find((p) => p.configured()) || perplexity;
}

export function missingKey() {
  if (PROVIDERS.some((p) => p.configured())) return null;
  return (
    "No model API key is set. Add PERPLEXITY_API_KEY to .env.local for local " +
    "development, or to your Vercel project's environment variables. " +
    "ANTHROPIC_API_KEY works too if you'd rather use Claude."
  );
}

// The one message a person sees when something goes wrong that isn't their
// fault. Providers name what they can; everything else is the same to a reader.
export function userFacingError(err) {
  return (
    provider().describeError?.(err) || "Something went wrong reaching the model. Try again."
  );
}
