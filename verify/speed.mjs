// Does tapping a chat actually open faster?
//
// "It feels snappier" is not a measurement. This drives a real browser against
// a deliberately slow database — 400ms per read, roughly a bad mobile
// connection — and times how long it takes from click to the conversation
// being on screen.
//
//   npm run dev
//   node verify/speed.mjs
//
// Three paths are timed, because they're three different experiences:
// a cold open (nothing cached), a warm one (opened before), and a prefetched
// one (the pointer touched the row first).

import { chromium } from "playwright";

const URL = process.env.SELFLIGHT_URL || "http://localhost:5173/";
const LATENCY = 400;

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {})
});

const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const failures = [];
page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

await page.route("**/api/capabilities", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ provider: "Perplexity", configured: true, connectors: false, searchAlwaysOn: true })
  })
);

await page.route("**/api/chat", (route) => {
  const body = route.request().postDataJSON();
  if (body?.task === "title") {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ title: null })
    });
  }
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: `data: ${JSON.stringify({ text: "A reply worth keeping." })}\n\ndata: {"done":true}\n\n`
  });
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("textarea");

// Slow the store down to something a phone on mobile data would see. Signed
// out the store is localStorage, so this patches it directly rather than
// standing up a Supabase project — what's being measured is the app's
// behaviour around a slow read, not the read itself.
//
// Installed as an init script rather than a one-off evaluate, so it survives
// the reload below. That reload is what makes the cold measurement honest.
const slowdown = (ms) => {
  const original = Storage.prototype.getItem;
  Storage.prototype.getItem = function (key) {
    // Only the chat store is slowed, and only for reads that aren't the app
    // starting up — settings and palettes stay instant so the measurement
    // isn't dominated by unrelated work.
    if (key === "selflight.chats.v1" && window.__slowReads) {
      const until = performance.now() + ms;
      while (performance.now() < until) {
        /* block, the way a network read blocks a fetch */
      }
    }
    return original.call(this, key);
  };
};

await page.addInitScript(slowdown, LATENCY);
await page.evaluate(slowdown, LATENCY);

/* ------------------------------ build a history --------------------------- */

async function makeChat(text) {
  await page.click("text=New chat");
  await page.fill("textarea", text);
  await page.press("textarea", "Enter");
  await page.waitForTimeout(500);
}

await makeChat("First conversation about migrations");
await makeChat("Second conversation about pricing");
await makeChat("Third conversation about colours");

// Reload, so nothing is cached. Creating a chat also caches it, which made the
// first version of this file measure three warm opens and report the middle
// one as "cold" — a number that flattered the change it was meant to test.
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("textarea");
await page.evaluate(() => {
  window.__slowReads = true;
});

const rows = () => page.locator(".thin-scrollbar button:has-text('conversation')");
const count = await rows().count();
if (count < 3) {
  console.error(`\nOnly ${count} chats in the sidebar — need three to measure this.\n`);
  await browser.close();
  process.exit(2);
}

// The app reopens whatever was last read, so that chat is already cached and
// every measurement below deliberately avoids it.

/* -------------------------------- measuring ------------------------------- */

// Time from the click to the conversation being on screen. Deliberately waits
// for real text, not for a spinner to vanish — a skeleton that never resolves
// would otherwise measure as instant.
async function timeOpen(index, { prefetch = false } = {}) {
  const row = rows().nth(index);
  if (prefetch) {
    await row.hover();
    await page.waitForTimeout(LATENCY + 120);
  }

  const started = Date.now();
  await row.click();
  await page.waitForFunction(
    () => document.querySelector(".stack-msg")?.querySelector("[class*='bg-bubble']"),
    null,
    { timeout: 8000 }
  );
  return Date.now() - started;
}

// Row 0 is the most recently updated chat, which is the one the app restores on
// load — so it is already cached and cannot be measured cold. Rows 1 and 2 are
// the ones nothing has read yet.
const [first, second] = [1, 2];

// Cold: nothing cached, and the store is answering in 400ms.
const cold = await timeOpen(first);
// Warm: the same chat again, now that it has been read once.
const warm = await timeOpen(first);
// Prefetched: a different chat, hovered before it was clicked.
const prefetched = await timeOpen(second, { prefetch: true });

/* --------------------------------- report --------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};

console.log(`\n${c.bold("Selflight · opening a chat")}  ${c.dim(`${LATENCY}ms store, 3 chats`)}\n`);

const check = (label, ms, budget) => {
  const pass = ms <= budget;
  if (!pass) failures.push(`${label}: ${ms}ms (budget ${budget}ms)`);
  console.log(`  ${pass ? c.green("✓") : c.red("✗")} ${label.padEnd(28)} ${String(ms + "ms").padStart(7)}  ${c.dim(`budget ${budget}ms`)}`);
};

// The cold budget is the store's own latency plus render. It should be *slow* —
// if it isn't, the slowdown didn't take and the other two numbers mean nothing.
check("cold — never opened", cold, LATENCY + 600);
if (cold < LATENCY / 2) {
  failures.push(
    `cold opened in ${cold}ms against a ${LATENCY}ms store — the slowdown didn't apply, so warm and prefetched prove nothing`
  );
}
check("warm — opened before", warm, 150);
check("prefetched — hovered first", prefetched, 150);

console.log(
  `\n  ${c.dim(`warm is ${Math.max(1, Math.round(cold / Math.max(warm, 1)))}× faster than cold`)}\n`
);

await browser.close();

if (failures.length) {
  for (const f of failures) console.log(c.red(`  ${f}`));
  console.log();
  process.exit(1);
}
console.log(c.green("  Opening a cached chat is effectively instant.\n"));
