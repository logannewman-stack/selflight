// Drives /api/transcribe against a stand-in transcription service, so the route
// is exercised for real: what it accepts, what it refuses, what it forwards,
// and what it says when the service says no.
//
//   node --test api/transcribe.test.mjs
//
// No transcription key and no network beyond loopback.

import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";

process.env.TRANSCRIBE_API_KEY = "sk-transcribe-test";

let received = null;
let script = { status: 200, body: { text: "  the words that were said  " } };

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    received = {
      path: req.url,
      auth: req.headers.authorization,
      // Enough of the multipart body to see the filename and the model.
      body: Buffer.concat(chunks).toString("latin1")
    };
    res.writeHead(script.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(script.body));
  });
});

let transcribe;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.TRANSCRIBE_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  transcribe = (await import("./transcribe.js")).default;
});

after(() => server.close());

function request(audio, { type = "audio/webm", method = "POST", headers = {} } = {}) {
  const req = Readable.from([Buffer.isBuffer(audio) ? audio : Buffer.from(audio)]);
  req.method = method;
  req.headers = { "content-type": type, ...headers };
  return req;
}

function response() {
  const res = {
    status: null,
    chunks: [],
    writeHead(status) {
      res.status = status;
      return res;
    },
    end(chunk) {
      if (chunk) res.chunks.push(chunk);
    }
  };
  Object.defineProperty(res, "json", {
    get: () => JSON.parse(res.chunks.join("") || "{}")
  });
  return res;
}

async function post(audio, options) {
  const res = response();
  await transcribe(request(audio, options), res);
  return res;
}

// Big enough to clear the "too short to be speech" floor.
const AUDIO = Buffer.alloc(4000, 7);

/* -------------------------------- the path ------------------------------- */

test("audio in, words out", async () => {
  script = { status: 200, body: { text: "  the words that were said  " } };
  const res = await post(AUDIO);

  assert.equal(res.status, 200);
  // Trimmed, because a leading space would land in the middle of a sentence
  // when this gets appended to what was already typed.
  assert.equal(res.json.text, "the words that were said");
});

test("the recording is forwarded as a file the service can decode", async () => {
  await post(AUDIO);

  assert.equal(received.path, "/audio/transcriptions");
  assert.equal(received.auth, "Bearer sk-transcribe-test");
  assert.match(received.body, /name="model"/);
  assert.match(received.body, /whisper-1/);
  // The extension is how the service picks a decoder, so it has to follow what
  // the browser actually recorded rather than being hard-coded.
  assert.match(received.body, /filename="speech\.webm"/);
});

test("Safari records mp4, and that has to survive the trip", async () => {
  await post(AUDIO, { type: "audio/mp4" });
  assert.match(received.body, /filename="speech\.mp4"/);
});

test("a codec suffix doesn't confuse the extension", async () => {
  await post(AUDIO, { type: "audio/webm;codecs=opus" });
  assert.match(received.body, /filename="speech\.webm"/);
});

/* ------------------------------- refusals -------------------------------- */

test("only POST", async () => {
  const res = await post(AUDIO, { method: "GET" });
  assert.equal(res.status, 405);
});

test("an empty recording is refused before it costs anything", async () => {
  const res = await post(Buffer.alloc(0));
  assert.equal(res.status, 400);
  assert.match(res.json.error, /empty/i);
});

test("an oversized recording is refused with a sentence, not a stack trace", async () => {
  // Past the 4MB ceiling, which is where the platform would cut it off anyway.
  const res = await post(Buffer.alloc(4_500_000, 1));
  assert.equal(res.status, 413);
  assert.match(res.json.error, /too long/i);
});

/* -------------------------- when the service says no --------------------- */

test("a rejected transcription key is named as such", async () => {
  script = { status: 401, body: { error: { message: "invalid_api_key" } } };
  const res = await post(AUDIO);

  assert.equal(res.status, 502);
  assert.match(res.json.error, /key was rejected/i);
});

test("rate limiting says to wait rather than that something broke", async () => {
  script = { status: 429, body: { error: { message: "slow down" } } };
  const res = await post(AUDIO);
  assert.match(res.json.error, /rate limited/i);
});

test("an unfamiliar refusal passes the service's own words through", async () => {
  script = { status: 400, body: { error: { message: "Audio file is too short." } } };
  const res = await post(AUDIO);
  assert.match(res.json.error, /Audio file is too short/);
});
