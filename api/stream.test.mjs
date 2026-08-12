// Drives the Perplexity provider against a stand-in that speaks Sonar's wire
// format, so the streaming path is exercised for real: the HTTP request it
// builds, the SSE frames it parses, the reasoning it hides, the sources it
// surfaces, and the token counts the spend cap depends on.
//
//   node --test api/stream.test.mjs
//
// No Perplexity key and no network beyond loopback.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

process.env.PERPLEXITY_API_KEY = "pplx-test";

let received = null;
let script = [];

// Stands in for api.perplexity.ai. Records what it was sent, replies with
// whatever the current test queued.
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received = { path: req.url, auth: req.headers.authorization, body: JSON.parse(body) };

    if (script.status && script.status !== 200) {
      res.writeHead(script.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: script.message || "nope" } }));
    }

    if (!received.body.stream) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(script.json));
    }

    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const frame of script.frames) res.write(`data: ${JSON.stringify(frame)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

let perplexity;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.PERPLEXITY_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  perplexity = await import("./providers/perplexity.js");
});

after(() => server.close());

// Collects everything the provider tried to show the reader.
function recorder() {
  const seen = { text: "", activity: [], notice: [], sources: [], error: [] };
  return {
    seen,
    emit: {
      text: (t) => (seen.text += t),
      activity: (a) => seen.activity.push(a),
      notice: (n) => seen.notice.push(n),
      sources: (s) => seen.sources.push(...s),
      error: (e) => seen.error.push(e)
    }
  };
}

const delta = (content) => ({ choices: [{ delta: { content } }] });

async function converse(frames, settings = {}) {
  script = { frames };
  const { emit, seen } = recorder();
  const usage = await perplexity.converse({
    system: "You are Selflight.",
    messages: [{ role: "user", content: "who won?" }],
    settings,
    emit
  });
  return { seen, usage, sent: received };
}

/* ------------------------------ the request ------------------------------ */

test("the request is addressed and authenticated the way Sonar expects", async () => {
  const { sent } = await converse([delta("hi")]);

  assert.equal(sent.path, "/chat/completions");
  assert.equal(sent.auth, "Bearer pplx-test");
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.messages[0].role, "system");
  assert.equal(sent.body.messages[0].content, "You are Selflight.");
  assert.deepEqual(sent.body.messages[1], { role: "user", content: "who won?" });
});

test("thinking depth chooses the model and how widely it searches", async () => {
  const quick = await converse([delta("a")], { depth: "quick" });
  assert.equal(quick.sent.body.model, "sonar");
  assert.equal(quick.sent.body.web_search_options.search_context_size, "low");

  const deep = await converse([delta("a")], { depth: "deep" });
  assert.equal(deep.sent.body.model, "sonar-reasoning-pro");
  assert.equal(deep.sent.body.web_search_options.search_context_size, "high");
});

test("search runs only when the question needs it", async () => {
  const { sent } = await converse([delta("a")]);
  // The per-request search fee is charged per request that actually searches,
  // so this flag is the difference between paying for every hello and not.
  assert.equal(sent.body.enable_search_classifier, true);
});

test("turning web search off really turns it off", async () => {
  const { sent } = await converse([delta("a")], { webSearch: false });
  assert.equal(sent.body.disable_search, true);
  assert.ok(!sent.body.web_search_options, "no search means no search options");
});

test("building a page doesn't pay to search the web", async () => {
  script = { frames: [delta("<!doctype html>")] };
  const { emit } = recorder();
  await perplexity.converse({
    system: "build",
    messages: [{ role: "user", content: "a landing page" }],
    settings: {},
    kind: "build",
    emit
  });
  assert.equal(received.body.disable_search, true);
});

/* -------------------------------- the reply ------------------------------ */

test("streamed deltas arrive as one reply", async () => {
  const { seen } = await converse([delta("The "), delta("answer "), delta("is 4.")]);
  assert.equal(seen.text, "The answer is 4.");
});

test("a cumulative reply doesn't come out repeated", async () => {
  // Some responses restate the whole message rather than the delta; taking the
  // suffix is what keeps that from tripling the text.
  const { seen } = await converse([
    { choices: [{ message: { content: "One" } }] },
    { choices: [{ message: { content: "One two" } }] },
    { choices: [{ message: { content: "One two three" } }] }
  ]);
  assert.equal(seen.text, "One two three");
});

test("reasoning never reaches the reader, but is announced", async () => {
  const { seen } = await converse(
    [delta("<think>let me chec"), delta("k the table</think>"), delta("Argentina.")],
    { depth: "deep" }
  );

  assert.equal(seen.text, "Argentina.");
  assert.deepEqual(seen.activity, [{ kind: "tool", label: "Thinking it through" }]);
});

test("sources are surfaced once, not once per frame", async () => {
  const { seen } = await converse([
    { search_results: [{ title: "FIFA", url: "https://fifa.com/x" }], choices: [{ delta: { content: "Arg" } }] },
    { search_results: [{ title: "FIFA", url: "https://fifa.com/x" }], choices: [{ delta: { content: "entina." } }] }
  ]);

  assert.equal(seen.text, "Argentina.");
  assert.deepEqual(seen.sources, [{ title: "FIFA", url: "https://fifa.com/x" }]);
});

test("token counts come back for the spend cap", async () => {
  const { usage } = await converse([
    delta("hi"),
    { usage: { prompt_tokens: 1234, completion_tokens: 567 }, choices: [{ delta: { content: "" } }] }
  ]);

  assert.deepEqual(usage, { input: 1234, output: 567 });
});

test("a reply with no usage block still returns countable zeros", async () => {
  const { usage } = await converse([delta("hi")]);
  assert.deepEqual(usage, { input: 0, output: 0 });
});

/* -------------------------------- failures ------------------------------- */

test("a rejected key says which key", async () => {
  script = { status: 401, message: "invalid api key" };
  const { emit } = recorder();

  await assert.rejects(
    perplexity.converse({ system: "s", messages: [{ role: "user", content: "x" }], emit }),
    (err) => {
      assert.equal(err.status, 401);
      assert.match(perplexity.describeError(err), /PERPLEXITY_API_KEY/);
      return true;
    }
  );
});

test("running out of credit is its own message, not a generic failure", async () => {
  script = { status: 402, message: "insufficient credits" };
  const { emit } = recorder();

  await assert.rejects(
    perplexity.converse({ system: "s", messages: [{ role: "user", content: "x" }], emit }),
    (err) => {
      assert.match(perplexity.describeError(err), /out of credit/);
      return true;
    }
  );
});

/* --------------------------------- titles -------------------------------- */

test("a title is generated without paying to search", async () => {
  script = { json: { choices: [{ message: { content: "World Cup Winner" } }], usage: { prompt_tokens: 40, completion_tokens: 4 } } };

  const { text, usage } = await perplexity.title({
    messages: [{ role: "user", content: "Person: who won?" }],
    prompt: "Write a title."
  });

  assert.equal(text, "World Cup Winner");
  assert.deepEqual(usage, { input: 40, output: 4 });
  assert.equal(received.body.disable_search, true);
  assert.equal(received.body.model, "sonar", "a title doesn't need the expensive model");
});

/* ------------------------------- connectors ------------------------------ */

test("connectors are admitted to be unavailable rather than silently ignored", async () => {
  assert.equal(perplexity.unsupported([]), null);
  assert.equal(perplexity.unsupported([{ name: "linear", enabled: false }]), null);

  const one = perplexity.unsupported([{ name: "linear", enabled: true }]);
  assert.match(one, /MCP connectors don't work on Perplexity/);
  assert.match(one, /your connector\b/);

  assert.match(
    perplexity.unsupported([{ name: "a", enabled: true }, { name: "b", enabled: true }]),
    /your 2 connectors/
  );
});
