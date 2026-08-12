// Proves the door is actually locked.
//
// With a Supabase project configured, /api/chat must refuse anyone without a
// valid session — otherwise the first person to find the URL spends the API
// key's budget. That's the single most important thing accounts buy here, so it
// gets a test rather than a comment.
//
//   node --test api/auth.test.mjs
//
// No network and no real project: the Supabase URL points at a closed port, so
// verifying a token fails, which is exactly the "this session is no good" path.

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.PERPLEXITY_API_KEY = "pplx-test";
process.env.SUPABASE_URL = "https://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";

// Imported after the environment is set, because api/_supabase.js reads it once
// at module load — the same as it does in a serverless function.
const { default: chat } = await import("./chat.js");

function mockRequest({ headers = {}, body } = {}) {
  return {
    method: "POST",
    headers,
    body,
    on() {},
    off() {}
  };
}

function mockResponse() {
  const res = {
    status: null,
    headers: null,
    chunks: [],
    writeHead(status, headers) {
      res.status = status;
      res.headers = headers;
      return res;
    },
    write(chunk) {
      res.chunks.push(chunk);
    },
    end(chunk) {
      if (chunk) res.chunks.push(chunk);
      res.ended = true;
    }
  };
  return res;
}

const body = { messages: [{ role: "user", text: "what did I ask you yesterday?" }] };

test("a chat request with no session is refused", async () => {
  const res = mockResponse();
  await chat(mockRequest({ body }), res);

  assert.equal(res.status, 401);
  assert.match(res.chunks.join(""), /Sign in again/);
});

test("a chat request with a made-up token is refused", async () => {
  const res = mockResponse();
  await chat(
    mockRequest({ headers: { authorization: "Bearer not.a.real.token" }, body }),
    res
  );

  assert.equal(res.status, 401);
});

test("the refusal happens before the model is ever called", async () => {
  const res = mockResponse();
  await chat(mockRequest({ body }), res);

  // A streamed reply opens with an event-stream header. A plain JSON 401 means
  // nothing was spent getting there.
  assert.match(res.headers["Content-Type"], /application\/json/);
});

test("a build request is gated too, not just chat", async () => {
  const res = mockResponse();
  await chat(mockRequest({ body: { ...body, task: "build" } }), res);
  assert.equal(res.status, 401);
});

test("titles are gated too — they cost tokens like anything else", async () => {
  const res = mockResponse();
  await chat(mockRequest({ body: { ...body, task: "title" } }), res);
  assert.equal(res.status, 401);
});

test("a browser cannot smuggle in its own connectors", async () => {
  // Connectors are read from the database for a signed-in user, so a body that
  // claims one gets nowhere. Without a session it doesn't get that far at all.
  const res = mockResponse();
  await chat(
    mockRequest({
      body: { ...body, connectors: [{ name: "evil", url: "https://evil.example.com/sse", enabled: true }] }
    }),
    res
  );

  assert.equal(res.status, 401);
});
