// The two pieces of Perplexity's stream that fail quietly if they're wrong: the
// reasoning tags that must never reach the reader, and the sources that are the
// whole reason to use a search-grounded model.
//
//   node --test api/perplexity.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PERPLEXITY_API_KEY = "pplx-test";

const { _internals, tierFor } = await import("./providers/perplexity.js");
const { thinkFilter, toSources } = _internals;

// Feed a reply through the filter one chunk at a time, the way it arrives.
function run(chunks) {
  const filter = thinkFilter();
  return chunks.map(filter).map((step) => step.text).join("");
}

test("thinking depth picks a model and a search depth", () => {
  assert.equal(tierFor({ depth: "quick" }).model, "sonar");
  assert.equal(tierFor({ depth: "balanced" }).model, "sonar-pro");
  assert.equal(tierFor({ depth: "deep" }).model, "sonar-reasoning-pro");

  // Search context is the per-request fee, so it has to move with the tier.
  assert.deepEqual(
    ["quick", "balanced", "deep"].map((depth) => tierFor({ depth }).context),
    ["low", "medium", "high"]
  );

  assert.equal(tierFor({}).model, "sonar-pro", "an unset depth must still be valid");
});

test("only the reasoning model is expected to narrate", () => {
  assert.equal(tierFor({ depth: "deep" }).reasoning, true);
  assert.equal(tierFor({ depth: "balanced" }).reasoning, false);
});

test("reasoning is stripped out of the reply", () => {
  assert.equal(run(["<think>weighing it up</think>The answer."]), "The answer.");
});

test("reasoning split across chunks is still stripped", () => {
  // The tag lands across a chunk boundary, which is the case that actually
  // happens on the wire and the one a naive replace() gets wrong.
  assert.equal(run(["<thi", "nk>hmm</thi", "nk>Berlin."]), "Berlin.");
  assert.equal(run(["<think>a", "b", "c</think>", "Done."]), "Done.");
});

test("a lone angle bracket in normal prose survives", () => {
  assert.equal(run(["Use a < b to compare."]), "Use a < b to compare.");
  assert.equal(run(["if (x <", " y) return;"]), "if (x < y) return;");
});

test("text before the reasoning block is kept", () => {
  assert.equal(run(["Sure. <think>quietly</think>Here you go."]), "Sure. Here you go.");
});

test("an unclosed reasoning block never leaks", () => {
  // A truncated reply shouldn't dump raw reasoning into the thread.
  assert.equal(run(["<think>still going and then the stream died"]), "");
});

test("the filter reports when it is inside a reasoning block", () => {
  const filter = thinkFilter();
  assert.equal(filter("<think>working").thinking, true);
  assert.equal(filter("</think>done").thinking, false);
});

test("sources come through as titles and links", () => {
  const sources = toSources({
    search_results: [
      { title: "Sonar pricing", url: "https://docs.perplexity.ai/pricing" },
      { title: "", url: "https://www.example.com/a" }
    ]
  });

  assert.deepEqual(sources, [
    { title: "Sonar pricing", url: "https://docs.perplexity.ai/pricing" },
    // No title given, so the host stands in — "www." dropped, since it's noise.
    { title: "example.com", url: "https://www.example.com/a" }
  ]);
});

test("a bare list of citation URLs also works", () => {
  const sources = toSources({ citations: ["https://example.org/x"] });
  assert.deepEqual(sources, [{ title: "example.org", url: "https://example.org/x" }]);
});

test("anything that isn't a link is dropped", () => {
  const sources = toSources({
    search_results: [{ title: "Nope", url: "javascript:alert(1)" }, { title: "Also nope" }]
  });
  assert.deepEqual(sources, []);
});

test("a reply with no sources produces none", () => {
  assert.deepEqual(toSources({}), []);
  assert.deepEqual(toSources({ search_results: null }), []);
});
