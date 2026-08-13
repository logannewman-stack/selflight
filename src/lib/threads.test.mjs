// The cache has one job — make a tap instant — and two ways to be wrong about
// it: showing a conversation that isn't there any more, or asking the database
// for something it already has. Both are tested here against a store that
// counts its own calls.

import test from "node:test";
import assert from "node:assert/strict";
import { createThreadCache } from "./threads.js";

function fakeStore(threads = {}) {
  let calls = 0;
  let resolve;

  return {
    calls: () => calls,
    // Lets a test hold a fetch open and check what the cache does meanwhile.
    release: () => resolve?.(),
    store: {
      chats: {
        messages(id) {
          calls++;
          if (threads[id] === "hang") {
            return new Promise((r) => {
              resolve = () => r([{ role: "user", text: "late" }]);
            });
          }
          if (threads[id] === "fail") return Promise.reject(new Error("network"));
          return Promise.resolve(threads[id] || []);
        }
      }
    }
  };
}

test("a chat opened twice is only fetched once", () => {
  const fake = fakeStore({ a: [{ role: "user", text: "hi" }] });
  const cache = createThreadCache(fake.store);

  return cache
    .load("a")
    .then(() => cache.load("a"))
    .then((second) => {
      assert.equal(fake.calls(), 1);
      assert.equal(second[0].text, "hi");
    });
});

test("peek is synchronous — which is the whole point", async () => {
  const fake = fakeStore({ a: [{ role: "user", text: "hi" }] });
  const cache = createThreadCache(fake.store);

  // Nothing cached yet: a tap here has to wait, and must not claim otherwise.
  assert.equal(cache.peek("a"), null);

  await cache.load("a");

  // Now it's a property read, not a round trip. No await, no loading state,
  // no empty screen between tapping and seeing the conversation.
  assert.equal(cache.peek("a")[0].text, "hi");
});

test("warming makes the next open instant", async () => {
  const fake = fakeStore({ a: [{ role: "user", text: "hi" }] });
  const cache = createThreadCache(fake.store);

  cache.warm("a");
  await new Promise((r) => setImmediate(r));

  assert.ok(cache.peek("a"), "hovering the row should have loaded it");
  assert.equal(fake.calls(), 1);

  await cache.load("a");
  assert.equal(fake.calls(), 1, "opening it must not fetch again");
});

test("warming twice, or warming something already cached, asks once", async () => {
  const fake = fakeStore({ a: [] });
  const cache = createThreadCache(fake.store);

  cache.warm("a");
  cache.warm("a");
  cache.warm("a");
  await new Promise((r) => setImmediate(r));

  cache.warm("a");
  assert.equal(fake.calls(), 1);
});

test("a tap during a prefetch joins it rather than starting a second", async () => {
  const fake = fakeStore({ a: "hang" });
  const cache = createThreadCache(fake.store);

  cache.warm("a");
  const opening = cache.load("a");
  assert.equal(fake.calls(), 1, "the tap must not open a second request");

  fake.release();
  assert.equal((await opening)[0].text, "late");
});

test("a failed prefetch is silent, and doesn't poison the next open", async () => {
  const fake = fakeStore({ a: "fail" });
  const cache = createThreadCache(fake.store);

  cache.warm("a");
  await new Promise((r) => setImmediate(r));

  // Nothing cached, nothing thrown, nothing shown. The real open reports it.
  assert.equal(cache.peek("a"), null);
  await assert.rejects(() => cache.load("a"), /network/);
});

test("a write updates the cache, because the browser's copy is the current one", async () => {
  const fake = fakeStore({ a: [{ role: "user", text: "old" }] });
  const cache = createThreadCache(fake.store);

  await cache.load("a");
  cache.update("a", [{ role: "user", text: "new" }]);

  assert.equal(cache.peek("a")[0].text, "new");
  assert.equal(fake.calls(), 1, "updating must not trigger a fetch");
});

test("a deleted chat is forgotten", async () => {
  const fake = fakeStore({ a: [] });
  const cache = createThreadCache(fake.store);

  await cache.load("a");
  cache.forget("a");
  assert.equal(cache.peek("a"), null);
});

test("the cache is bounded, and evicts the least recently used", async () => {
  const many = Object.fromEntries(
    Array.from({ length: 60 }, (_, i) => [`c${i}`, [{ role: "user", text: `${i}` }]])
  );
  const cache = createThreadCache(fakeStore(many).store);

  for (let i = 0; i < 60; i++) await cache.load(`c${i}`);

  assert.ok(cache.size() <= 40, `cache grew to ${cache.size()} — it must be bounded`);
  assert.equal(cache.peek("c0"), null, "the oldest should have been evicted");
  assert.ok(cache.peek("c59"), "the newest should still be there");
});

test("reopening a chat keeps it from being evicted", async () => {
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`c${i}`, []]));
  const cache = createThreadCache(fakeStore(many).store);

  for (let i = 0; i < 39; i++) await cache.load(`c${i}`);
  await cache.load("c0"); // used again — should now be the freshest, not the stalest
  for (let i = 39; i < 55; i++) await cache.load(`c${i}`);

  assert.ok(cache.peek("c0"), "a chat you keep returning to shouldn't be the one dropped");
});

test("an empty conversation is a cache hit, not a miss", async () => {
  // The bug this prevents: `peek` returning null for a real-but-empty thread,
  // so a brand-new chat re-fetches on every tap forever.
  const fake = fakeStore({ a: [] });
  const cache = createThreadCache(fake.store);

  await cache.load("a");
  assert.deepEqual(cache.peek("a"), []);

  await cache.load("a");
  assert.equal(fake.calls(), 1);
});
