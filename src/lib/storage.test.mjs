// What happens to your history when the browser runs out of room, and whether
// the app remembers which conversation you were reading.
//
//   node --test src/lib/storage.test.mjs

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// A localStorage that can be told to be full, which is the only interesting
// thing about localStorage.
class Store {
  constructor() {
    this.data = new Map();
    this.limit = Infinity;
  }
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    const others = [...this.data].filter(([k]) => k !== key).reduce((n, [, v]) => n + v.length, 0);
    if (others + value.length > this.limit) {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}

const store = new Store();
globalThis.localStorage = store;

const { createChat, deleteChat, lastChat, listChats, rememberChat, saveMessages } = await import(
  "./storage.js"
);

beforeEach(() => {
  store.data.clear();
  store.limit = Infinity;
});

const add = (title, size = 20) =>
  createChat({ title, messages: [{ role: "user", text: "x".repeat(size) }] });

/* ------------------------------ remembering ------------------------------ */

test("chats survive being written and read back", () => {
  add("First");
  add("Second");

  assert.deepEqual(listChats().map((c) => c.title), ["Second", "First"]);
});

test("the most recently touched chat sorts to the top", async () => {
  const first = add("First");
  add("Second");

  // Ordering is by millisecond, and these are created in the same one. Real use
  // never ties; the test has to wait for a tick it would otherwise get free.
  await new Promise((resolve) => setTimeout(resolve, 5));
  saveMessages(first.id, [{ role: "user", text: "still going" }]);

  assert.equal(listChats()[0].title, "First");
});

test("which chat was open is remembered, and forgotten on request", () => {
  rememberChat("c-123");
  assert.equal(lastChat(), "c-123");

  rememberChat(null);
  assert.equal(lastChat(), null, "starting a new chat shouldn't reopen the old one");
});

test("a deleted chat is really gone", () => {
  const chat = add("Doomed");
  add("Kept");
  deleteChat(chat.id);

  assert.deepEqual(listChats().map((c) => c.title), ["Kept"]);
});

/* --------------------------- when it runs out ---------------------------- */

test("a full browser keeps the newest chats rather than silently saving none", () => {
  // Fill it, then shrink the ceiling so the next write cannot fit.
  for (let i = 0; i < 12; i++) add(`Chat ${i}`, 400);
  const before = listChats().length;
  assert.equal(before, 12);

  store.limit = 2500;
  add("The newest one", 400);

  const after = listChats();
  assert.ok(after.length < before + 1, "something had to be dropped");
  assert.ok(after.length > 0, "dropping everything would be worse than dropping some");
  // The whole point: the chat you just had is the one that survives.
  assert.equal(after[0].title, "The newest one");
});

test("what survives is the most recent, not an arbitrary slice", () => {
  for (let i = 0; i < 8; i++) add(`Old ${i}`, 300);
  store.limit = 1600;
  add("Newest", 300);

  const titles = listChats().map((c) => c.title);
  assert.equal(titles[0], "Newest");
  // Whatever else is kept came from the end of the list, not the start.
  for (const title of titles.slice(1)) {
    assert.match(title, /^Old [4-7]$/, `kept ${title}, which is older than something it dropped`);
  }
});

test("a browser that refuses storage entirely doesn't throw", () => {
  store.limit = 0;
  // Private mode and blocked-storage settings both look like this. The session
  // has to keep working, in memory, rather than the app falling over.
  assert.doesNotThrow(() => add("Nowhere to go"));
  assert.doesNotThrow(() => rememberChat("c-1"));
});
