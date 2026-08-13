// What this deployment can actually do, so the interface can stop offering
// things the configured model has no way to perform.
//
// Deliberately says nothing secret: the provider's name and two booleans. No
// key, no account, no session needed — it's the same answer for everyone.

import { provider } from "./provider.js";
import { configured as canTranscribe } from "./transcribe.js";
import { catalogue } from "./_catalogue.js";

export default async function handler(req, res) {
  const model = provider();

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    // Fine to hold briefly — it only changes when the deployment's keys do.
    "Cache-Control": "public, max-age=60"
  });

  res.end(
    JSON.stringify({
      provider: model.name,
      configured: model.configured(),
      // Perplexity's API has no MCP equivalent, and its models search on their
      // own rather than through a tool the interface can switch off.
      connectors: model.name !== "Perplexity",
      searchAlwaysOn: model.name === "Perplexity",
      // Whether a browser with no speech recognition of its own can still
      // dictate, by sending audio here.
      transcribe: canTranscribe(),
      // Services someone can connect by signing in, and for the rest, which
      // variable is missing. No secret is in this — a variable's name isn't
      // one, and the alternative is a Connect button that fails after the
      // redirect with nothing to say why.
      services: catalogue()
    })
  );
}
