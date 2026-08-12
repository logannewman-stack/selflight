// Speech recognition can't be exercised without a microphone, but the two parts
// that actually go wrong can: how partial and final phrases are turned into a
// message, and whether a failure leaves the microphone open.
//
//   node --test src/lib/dictation.test.mjs

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

/* ------------------------- a stand-in for the API ------------------------ */

class FakeRecognition {
  static last = null;

  constructor() {
    this.started = 0;
    this.stopped = 0;
    FakeRecognition.last = this;
  }

  start() {
    this.started++;
  }

  stop() {
    this.stopped++;
    // The real one fires onend after stop(), which is what restarts a session
    // that hasn't been deliberately ended.
    this.onend?.();
  }

  // Feed it phrases: ["hello", true] is committed, ["wor", false] is a guess.
  say(phrases) {
    this.onresult({
      resultIndex: 0,
      results: phrases.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal }))
    });
  }

  fail(error) {
    this.onerror({ error });
  }
}

global.window = { SpeechRecognition: FakeRecognition };
// navigator exists in modern Node and is read-only, so the language is defined
// onto it rather than replacing the whole object.
Object.defineProperty(globalThis.navigator, "language", {
  value: "en-GB",
  configurable: true
});

const { dictate, supported } = await import("./dictation.js");

let seen;
beforeEach(() => {
  seen = { text: [], errors: [], ended: 0 };
});

const start = () =>
  dictate({
    onText: (t) => seen.text.push(t),
    onError: (e) => seen.errors.push(e),
    onEnd: () => seen.ended++
  });

/* --------------------------------- tests --------------------------------- */

test("it only offers itself where the browser can do it", () => {
  assert.equal(supported, true);
});

test("it listens in the browser's language, not an assumed one", () => {
  start();
  assert.equal(FakeRecognition.last.lang, "en-GB");
});

test("it keeps listening through a pause rather than ending mid-sentence", () => {
  start();
  const engine = FakeRecognition.last;
  assert.equal(engine.started, 1);

  // Chrome ends the session on its own after a silence.
  engine.onend();
  assert.equal(engine.started, 2, "a pause must not end dictation");
  assert.equal(seen.ended, 0);
});

test("stopping is final", () => {
  const session = start();
  session.stop();

  assert.equal(FakeRecognition.last.started, 1, "no restart after a deliberate stop");
  assert.equal(seen.ended, 1);
});

test("words arrive as guesses, then as committed text", () => {
  start();
  FakeRecognition.last.say([["what does a message", false]]);
  FakeRecognition.last.say([["what does a message cost", true]]);

  assert.deepEqual(seen.text, [
    { text: "what does a message", final: false },
    { text: "what does a message cost", final: true }
  ]);
});

test("a blocked microphone says how to unblock it", () => {
  start();
  FakeRecognition.last.fail("not-allowed");
  assert.match(seen.errors[0], /Microphone access was blocked/);
  assert.match(seen.errors[0], /address bar/);
});

test("silence and deliberate stops are not reported as errors", () => {
  start();
  FakeRecognition.last.fail("no-speech");
  FakeRecognition.last.fail("aborted");
  assert.deepEqual(seen.errors, [], "normal events must not look like failures");
});

test("an unfamiliar failure still surfaces something", () => {
  start();
  FakeRecognition.last.fail("some-new-error-code");
  assert.equal(seen.errors.length, 1);
});
