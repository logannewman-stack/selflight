// The request shape, per model.
//
// This file exists because of one bug that would have reached production and
// failed on the very first request: the Quick tier now routes to Haiku 4.5,
// which predates adaptive thinking and the `effort` parameter and returns a 400
// for either. The code that sends them was written when every turn ran on Opus,
// where both are fine — so nothing looked wrong, and every Quick message would
// have died.
//
// The second thing here is quieter and would never have been reported as a bug:
// these models default `thinking.display` to "omitted", which still streams
// thinking blocks, with empty text. The thinking panel renders nothing, forever,
// with no error anywhere.
//
// Neither is visible in a screenshot and neither throws locally without an API
// key, which is why they're asserted on the request object rather than observed.

import test from "node:test";
import assert from "node:assert/strict";
import { baseRequest } from "./providers/anthropic.js";
import { MODELS, supportsDynamicFiltering, supportsEffort, webToolsFor } from "./_pricing.js";
import { toTools } from "./prompt.js";

const shapeFor = (depth, extra = {}) =>
  baseRequest({ model: MODELS[depth], system: "you are polstar", settings: { depth }, ...extra });

/* ------------------------------ the 400 guard ----------------------------- */

test("the cheap model is sent neither effort nor thinking", () => {
  // Both are a 400 on Haiku 4.5. This is the whole reason the gate exists.
  const request = shapeFor("quick");

  assert.equal(request.model, MODELS.quick);
  assert.equal(request.output_config, undefined, "effort would be rejected by this model");
  assert.equal(request.thinking, undefined, "adaptive thinking would be rejected by this model");
});

test("the models that do accept them are sent both", () => {
  for (const depth of ["balanced", "deep"]) {
    const request = shapeFor(depth);
    assert.ok(request.output_config?.effort, `${depth}: expected an effort level`);
    assert.equal(request.thinking?.type, "adaptive", `${depth}: expected adaptive thinking`);
  }
});

test("the gate is driven by the capability table, not by a guess", () => {
  // If a model is added to MODELS without a decision about this, the shape it
  // gets must still match what _pricing.js says it can take.
  for (const [depth, model] of Object.entries(MODELS)) {
    const request = shapeFor(depth);
    assert.equal(
      Boolean(request.output_config),
      supportsEffort(model),
      `${model}: request shape disagrees with supportsEffort()`
    );
  }
});

/* --------------------------- the silent-blank guard ----------------------- */

test("thinking is asked for as a summary, or the panel shows nothing", () => {
  // The default is "omitted" — thinking blocks arrive with empty text, so the
  // UI renders an empty panel and never errors.
  for (const depth of ["balanced", "deep"]) {
    assert.equal(
      shapeFor(depth).thinking.display,
      "summarized",
      `${depth}: without this the thinking panel is permanently blank`
    );
  }
});

/* ------------------------- the web tools, per model ----------------------- */

// What went wrong on the live site: the Quick tier printed "Web tools aren't
// available on this API key" on every reply and answered without searching,
// while Balanced searched fine. The key was fine. `web_search_20260209` and
// later run the search inside code execution — that's what dynamic filtering
// is — and Anthropic documents that as Claude 4.6 and later. Haiku 4.5 predates
// it, so the API rejected the tool and the fallback quietly answered without
// one, which looked like ordinary operation.

test("the model that can't do dynamic filtering gets the basic tool versions", () => {
  const types = toTools({}, [], MODELS.quick).map((t) => t.type);
  assert.deepEqual(types, ["web_search_20250305", "web_fetch_20250910"]);
});

test("the models that can do it keep the dated versions", () => {
  for (const depth of ["balanced", "deep"]) {
    const types = toTools({}, [], MODELS[depth]).map((t) => t.type);
    assert.deepEqual(
      types,
      ["web_search_20260209", "web_fetch_20260209"],
      `${depth} should keep dynamic filtering`
    );
  }
});

test("search and fetch are never a mismatched pair", () => {
  // Mixing them is the confusing half of this bug: one of the two 400s and the
  // other doesn't, so the symptom depends on which the model reached for first.
  for (const model of Object.values(MODELS)) {
    const { search, fetch } = webToolsFor(model);
    const dated = (type) => /_20260\d{3}$/.test(type);
    assert.equal(
      dated(search),
      dated(fetch),
      `${model}: got ${search} with ${fetch} — both must be dated or both basic`
    );
  }
});

test("the tool shape follows the capability table rather than a guess", () => {
  for (const model of Object.values(MODELS)) {
    const usesDynamic = toTools({}, [], model).some((t) => /_20260209$/.test(t.type));
    assert.equal(
      usesDynamic,
      supportsDynamicFiltering(model),
      `${model}: tool version disagrees with supportsDynamicFiltering()`
    );
  }
});

test("no model can be sent a tool version it rejects", () => {
  // The regression, stated as the thing that must never be true again: the
  // Quick model paired with a dynamic-filtering tool.
  const quick = toTools({ webSearch: true, webFetch: true }, [], MODELS.quick);
  assert.ok(
    quick.every((t) => !/_20260/.test(t.type)),
    `Quick was handed ${quick.map((t) => t.type).join(", ")}`
  );
  assert.equal(quick.length, 2, "and it must still get both web tools, not none");
});

test("turning a tool off still turns it off, on every model", () => {
  for (const model of Object.values(MODELS)) {
    assert.deepEqual(toTools({ webSearch: false, webFetch: false }, [], model), []);
    assert.deepEqual(
      toTools({ webSearch: false }, [], model).map((t) => t.name),
      ["web_fetch"],
      `${model}: the wrong tool survived`
    );
  }
});

/* -------------------------------- the basics ------------------------------ */

test("every request carries the system prompt and the cache breakpoint", () => {
  for (const depth of Object.keys(MODELS)) {
    const request = shapeFor(depth);
    assert.equal(request.system, "you are polstar", `${depth}: lost the system prompt`);
    assert.equal(request.cache_control?.type, "ephemeral", `${depth}: lost the cache breakpoint`);
    assert.ok(request.max_tokens > 0, `${depth}: needs an output budget`);
  }
});

test("the depth dial reaches the effort level, not just the model", () => {
  assert.equal(shapeFor("balanced").output_config.effort, "medium");
  assert.equal(shapeFor("deep").output_config.effort, "high");
});

test("a generated page gets the highest effort whatever the chat is set to", () => {
  const request = baseRequest({ model: MODELS.deep, system: "x", settings: { depth: "quick" }, build: true });
  assert.equal(request.output_config.effort, "high");
});

test("max_tokens fits inside the cheapest model's output ceiling", () => {
  // Haiku 4.5 caps at 64K output where the 5-series models allow 128K. A budget
  // set for the larger models is rejected by the smaller one.
  assert.ok(
    shapeFor("quick").max_tokens <= 64000,
    "the Quick model's output ceiling is 64K — a larger budget is a 400"
  );
});
