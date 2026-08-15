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

const {
  createChat,
  deleteChat,
  lastChat,
  listChats,
  rememberChat,
  renameChat,
  saveMessages,
  searchMessages,
  setPinned
} = await import("./storage.js");

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

/* -------------------------- pinning and renaming ------------------------- */

test("a pinned chat sits above newer unpinned ones", async () => {
  const old = add("From last month");
  await new Promise((resolve) => setTimeout(resolve, 5));
  add("Newer");

  setPinned(old.id, true);

  assert.deepEqual(listChats().map((c) => c.title), ["From last month", "Newer"]);
});

test("pinning doesn't misdate the conversation", async () => {
  const chat = add("Old thread");
  const when = listChats()[0].updatedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));

  setPinned(chat.id, true);

  // Bumping updatedAt would move a chat from March into "Today" the moment you
  // pinned it, and back out again the moment you unpinned it.
  assert.equal(listChats()[0].updatedAt, when, "pinning is not activity");
});

test("unpinning puts it back where it belongs", async () => {
  const old = add("From last month");
  await new Promise((resolve) => setTimeout(resolve, 5));
  add("Newer");

  setPinned(old.id, true);
  setPinned(old.id, false);

  assert.deepEqual(listChats().map((c) => c.title), ["Newer", "From last month"]);
});

test("two pinned chats keep their own order", async () => {
  add("First");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = add("Second");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const third = add("Third");

  setPinned(second.id, true);
  setPinned(third.id, true);

  assert.deepEqual(listChats().map((c) => c.title), ["Third", "Second", "First"]);
});

test("renaming doesn't misdate the conversation either", async () => {
  const chat = add("Untitled");
  const when = listChats()[0].updatedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));

  renameChat(chat.id, "Deployment problem");

  const [renamed] = listChats();
  assert.equal(renamed.title, "Deployment problem");
  assert.equal(renamed.updatedAt, when);
});

test("renaming keeps the messages", () => {
  const chat = createChat({ title: "Old name", messages: [{ role: "user", text: "hello" }] });
  renameChat(chat.id, "New name");

  assert.deepEqual(listChats()[0].messages, [{ role: "user", text: "hello" }]);
});

/* ------------------------- searching inside chats ------------------------ */

const withMessages = (title, ...texts) =>
  createChat({ title, messages: texts.map((text) => ({ role: "user", text })) });

test("a phrase inside a message finds the chat it's in", () => {
  withMessages("Groceries", "milk and eggs");
  withMessages("Work", "the staging database is down again");

  const hits = searchMessages("staging database");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, "Work");
  assert.match(hits[0].snippet, /staging database/);
});

test("one hit per chat, however many times it matched", () => {
  // Six rows from one conversation would bury the five others that matched.
  withMessages("Busy thread", "deploy failed", "deploy failed again", "deploy fixed");
  withMessages("Other thread", "deploy notes");

  const hits = searchMessages("deploy");
  assert.equal(hits.length, 2);
  assert.equal(new Set(hits.map((h) => h.chatId)).size, 2);
});

test("searching is case insensitive", () => {
  withMessages("Notes", "The Migration Ran Cleanly");
  assert.equal(searchMessages("migration ran").length, 1);
});

test("one letter searches nothing", () => {
  withMessages("Notes", "anything at all");
  // Every chat matches "a". Returning all of them isn't a search result, it's
  // the list you already had.
  assert.deepEqual(searchMessages("a"), []);
  assert.deepEqual(searchMessages(""), []);
  assert.deepEqual(searchMessages("  "), []);
});

test("a chat with no messages doesn't throw", () => {
  createChat({ title: "Empty", messages: [] });
  assert.doesNotThrow(() => searchMessages("anything"));
});

test("the limit is honoured", () => {
  for (let i = 0; i < 40; i++) withMessages(`Chat ${i}`, "shared phrase");
  assert.equal(searchMessages("shared phrase", 5).length, 5);
});

/* --------------------------- bringing settings forward -------------------- */
//
// Changing a default only reaches browsers that have never stored anything.
// Everyone already using Polstar carries a blob naming the old palette, so a
// new default changes nothing for exactly the people who are already here —
// which is how "the appearance change didn't do anything" happens.

const { DEFAULT_SETTINGS, SETTINGS_VERSION, migrate, loadSettings, saveSettings } = await import(
  "./storage.js"
);

test("a browser that has never stored anything gets the current defaults", () => {
  const s = migrate({});
  assert.equal(s.theme, DEFAULT_SETTINGS.theme);
  assert.equal(s.v, SETTINGS_VERSION);
});

test("settings written before the change move to the new palette", () => {
  // The exact blob an existing browser holds: every colour control still at the
  // values that shipped before High contrast became the default.
  const old = {
    theme: "paper",
    lightTheme: "paper",
    darkTheme: "midnight",
    matchSystem: false,
    accent: "palette",
    accentCustom: "",
    baseColor: "",
    textSize: "lg"
  };

  const s = migrate(old);
  assert.equal(s.theme, "contrast");
  assert.equal(s.lightTheme, "contrast");
  assert.equal(s.darkTheme, "contrast-dark");
  // Everything that isn't a colour is untouched.
  assert.equal(s.textSize, "lg");
});

test("a palette somebody actually chose is left alone", () => {
  const s = migrate({ theme: "nocturne", lightTheme: "paper", darkTheme: "midnight" });
  assert.equal(s.theme, "nocturne", "overwriting a deliberate choice would be its own bug");
});

test("a main colour somebody set is left alone", () => {
  const s = migrate({ theme: "paper", baseColor: "#3B6EA5" });
  assert.equal(s.theme, "paper");
  assert.equal(s.baseColor, "#3B6EA5");
});

test("an accent somebody picked is left alone", () => {
  assert.equal(migrate({ theme: "paper", accent: "teal" }).theme, "paper");
});

test("a changed dark pairing counts as a choice", () => {
  assert.equal(migrate({ theme: "paper", darkTheme: "nocturne" }).theme, "paper");
});

test("match system on counts as a choice", () => {
  assert.equal(migrate({ theme: "paper", matchSystem: true }).theme, "paper");
});

test("it only runs once", () => {
  // Somebody who is moved and then deliberately goes back to Paper must stay on
  // Paper — a migration that reapplies every load is a setting you can't change.
  const moved = migrate({ theme: "paper" });
  assert.equal(moved.theme, "contrast");

  const wentBack = migrate({ ...moved, theme: "paper" });
  assert.equal(wentBack.theme, "paper");
});

test("the version is stamped so it can't run twice", () => {
  assert.equal(migrate({ theme: "paper" }).v, SETTINGS_VERSION);
});

test("it survives a round trip through storage", () => {
  store.data.clear();
  saveSettings({ theme: "paper", lightTheme: "paper", darkTheme: "midnight", textSize: "sm" });

  const loaded = loadSettings();
  assert.equal(loaded.theme, "contrast");
  assert.equal(loaded.textSize, "sm");

  // And once saved back, it stays put.
  saveSettings(loaded);
  assert.equal(loadSettings().theme, "contrast");
});

test("the older typeface migration still works alongside it", () => {
  const s = migrate({ uiFace: "serif", readingFace: "system", theme: "paper" });
  assert.equal(s.uiFont, "source-serif");
  assert.equal(s.replyFont, "system");
  assert.equal(s.theme, "contrast");
});

test("nothing is thrown at rubbish", () => {
  assert.doesNotThrow(() => migrate(undefined));
  assert.doesNotThrow(() => migrate({}));
  assert.equal(migrate(undefined).theme, DEFAULT_SETTINGS.theme);
});
