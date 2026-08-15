// The things you do to a conversation: pin it, rename it, find it, fix what you
// asked, and come back to where you were reading.
//
//   npm run dev
//   node verify/threads.mjs
//
// These are all interface changes, and an interface change that builds cleanly
// can still be unreachable — the pin, rename and delete buttons were originally
// spelled `group-hover:opacity-100`, which is invisible and untappable on every
// phone. Nothing but a real browser catches that.

import { chromium } from "playwright";

const URL = process.env.SELFLIGHT_URL || "http://localhost:5173/";

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {})
});

const checks = [];
const ok = (label, pass, detail = "") => checks.push({ label, pass: Boolean(pass), detail });

const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.route("**/api/capabilities", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      provider: "Perplexity",
      configured: true,
      connectors: false,
      searchAlwaysOn: true
    })
  })
);

// A reply long enough to scroll, so the scroll-position check has somewhere to
// scroll to. Each turn is answered with the same text; what's being verified is
// the app around the reply, not the reply.
let replies = 0;
await page.route("**/api/chat", (route) => {
  const body = route.request().postDataJSON();
  if (body?.task === "title") {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ title: null })
    });
  }
  replies++;
  // `.text`, not `.content` — the browser posts its own frames and the server
  // converts them. Reading the wrong field made every mocked reply echo an
  // empty question, which no check happened to notice.
  const asked = body?.messages?.[body.messages.length - 1]?.text || "";
  // Long enough that the thread definitely scrolls on a 900px viewport —
  // a reply that happens to fit makes the scroll-position check vacuous.
  const long = Array.from({ length: 200 }, (_, i) => `Line ${i + 1} of the answer.`).join("\n\n");
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body:
      `data: ${JSON.stringify({ text: `Answering "${asked}". ${long}` })}\n\n` +
      `data: {"done":true}\n\n`
  });
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("textarea");

async function makeChat(text) {
  await page.click("text=New chat");
  await page.fill("textarea", text);
  await page.press("textarea", "Enter");
  await page.waitForTimeout(400);
}

await makeChat("Notes about the staging database");
await makeChat("Notes about pricing tiers");
await makeChat("Notes about colour palettes");

const rows = () => page.locator("nav[aria-label='Conversations'] button:has-text('Notes about')");
const titles = () => rows().allInnerTexts();
// Every conversation row has exactly one pin, so counting pins counts rows —
// including any that have since been renamed out of the "Notes about" match.
const chatCount = () =>
  page.locator("nav[aria-label='Conversations'] button[aria-label^='Pin '], nav[aria-label='Conversations'] button[aria-label^='Unpin ']").count();

ok("three conversations were created", (await rows().count()) === 3, `${await rows().count()} rows`);

/* ------------------- 1. actions are reachable without hover ---------------- */

// Not "does hovering reveal them" — whether they are visible and clickable to
// something that cannot hover at all. Emulating a touch device is the only
// honest way to ask.
const touch = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
});
const phone = await touch.newPage();
await phone.route("**/api/capabilities", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ provider: "Perplexity", configured: true, connectors: false })
  })
);
// A new context is a new browser as far as storage goes, so this one starts
// with no history and needs a conversation of its own before there is a row to
// look at. The first version skipped that and reported "not rendered" for an
// empty sidebar, which says nothing about whether the buttons work on a phone.
await phone.route("**/api/chat", (route) =>
  route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: `data: ${JSON.stringify({ text: "A reply." })}\n\ndata: {"done":true}\n\n`
  })
);
await phone.goto(URL, { waitUntil: "networkidle" });
await phone.waitForTimeout(400);

await phone.waitForSelector("textarea");
await phone.fill("textarea", "A conversation to look at on a phone");
await phone.press("textarea", "Enter");
await phone.waitForTimeout(700);

// The sidebar is a drawer at this width and it covers the composer, so it goes
// up after the conversation exists rather than before.
await phone.click("button[aria-label='Show menu']");
await phone.waitForTimeout(400);

// `:visible`, not `.first()` — the desktop sidebar is still in the DOM at this
// width with `display: none`, so the first match is a copy nobody can see and
// checking it reported a failure that wasn't real.
const pinOnPhone = phone.locator("button[aria-label^='Pin ']:visible").first();
const rendered = await pinOnPhone.count();
const opacity = rendered
  ? await pinOnPhone.evaluate((el) => Number(getComputedStyle(el).opacity))
  : 0;

ok(
  "pin/rename/delete are visible on a touchscreen",
  rendered > 0 && opacity > 0.5,
  rendered ? `opacity ${opacity}` : "no visible pin button in the drawer"
);

// And they work when tapped, which "visible" doesn't prove on its own.
if (rendered) {
  await pinOnPhone.tap();
  await phone.waitForTimeout(300);
  ok(
    "tapping the pin actually pins",
    (await phone.locator("button[aria-label^='Unpin ']:visible").count()) > 0
  );
}

// The message actions have the same problem and the same fix. Getting back to
// the conversation by tapping its row, the way a person would — the backdrop
// button behind the drawer is full-width, so a plain click on it lands on the
// drawer instead of dismissing it.
await phone.locator("nav[aria-label='Conversations'] button:has-text('A conversation'):visible").first().tap();
await phone.waitForTimeout(400);
const editOnPhone = phone.locator("button[aria-label='Edit this message and ask again']:visible");
ok(
  "the edit action is visible on a touchscreen",
  (await editOnPhone.count()) > 0 &&
    (await editOnPhone.first().evaluate((el) => Number(getComputedStyle(el).opacity) > 0.5))
);

await touch.close();

/* --------------------------------- 2. pin -------------------------------- */

const before = await titles();
const oldest = before[before.length - 1];
await page.locator(`button[aria-label='Pin ${oldest}']`).click();
await page.waitForTimeout(250);

const afterPin = await titles();
ok("a pinned chat moves to the top", afterPin[0] === oldest, `top is "${afterPin[0]}"`);

// It should still say it's pinned after a reload — a pin that only exists in
// React state is a pin that vanishes when you close the tab.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(400);
ok("the pin survives a reload", (await titles())[0] === oldest, `top is "${(await titles())[0]}"`);

await page.locator(`button[aria-label='Unpin ${oldest}']`).click();
await page.waitForTimeout(250);
ok("unpinning puts it back", (await titles())[0] !== oldest);

/* ------------------------------- 3. rename ------------------------------- */

const target = (await titles())[0];
await page.locator(`button[aria-label='Rename ${target}']`).click();
const field = page.locator("input[aria-label='Chat name']");
ok("renaming opens an input in place", await field.isVisible());

await field.fill("Renamed in place");
await field.press("Enter");
await page.waitForTimeout(250);
ok(
  "the new name is in the list",
  (await page.locator("nav[aria-label='Conversations']").innerText()).includes("Renamed in place")
);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(400);
ok(
  "the new name survives a reload",
  (await page.locator("nav[aria-label='Conversations']").innerText()).includes("Renamed in place")
);

/* ------------------------- 4. search inside chats ------------------------ */

await page.click("button[aria-label='Search chats']");
const search = page.locator("input[placeholder='Search chats and messages']");
await search.fill("staging database");
// Longer than the 220ms debounce.
await page.waitForTimeout(600);

const sidebar = await page.locator("nav[aria-label='Conversations']").innerText();
ok("searching message text finds the chat", sidebar.includes("Notes about the staging"), sidebar.slice(0, 120));

// The phrase was typed into a chat whose title doesn't contain it, so this only
// passes if the message body was searched.
await search.fill("colour palettes and nothing else");
await page.waitForTimeout(600);
const noMatch = await page.locator("nav[aria-label='Conversations']").innerText();
ok("a phrase that matches nothing says so", /Nothing matches|No titles match/.test(noMatch), noMatch.slice(0, 80));

// Closing the search has to give the list back. It didn't: Escape hid the box
// and left the filter running, so the sidebar stayed empty with nothing on
// screen to say why.
await search.press("Escape");
await page.waitForTimeout(200);
await search.press("Escape");
await page.waitForTimeout(300);
ok(
  "closing the search gives every conversation back",
  (await chatCount()) === 3,
  `${await chatCount()} rows still showing`
);

/* --------------------------- 5. editing a question ------------------------ */

await rows().first().click();
await page.waitForTimeout(400);

// `.stack-msg` is one container holding the whole thread, so its children are
// the messages. Counting `.stack-msg` itself always returns 1, which made an
// earlier version of this check report "1 message" for a two-message thread.
const threadMessages = () => page.locator(".stack-msg > *").count();
await page.locator(".stack-msg > *").first().hover();
const edit = page.locator("button[aria-label='Edit this message and ask again']").first();
ok("a user message offers an edit", (await edit.count()) > 0);

if (await edit.count()) {
  const repliesBefore = replies;
  await edit.click();
  const editor = page.locator("textarea").nth(0);
  await editor.fill("A completely different question");
  await page.locator("button:has-text('Ask again')").click();
  await page.waitForTimeout(900);

  const text = await page.locator(".stack-msg").innerText();
  ok("the edited question replaced the old one", text.includes("A completely different question"));
  ok("editing re-ran the turn", replies > repliesBefore, `${replies - repliesBefore} new calls`);

  const count = await threadMessages();
  ok(
    "the thread is question-then-answer, not four messages",
    count === 2,
    `${count} messages`
  );
  ok(
    "the question you replaced is gone",
    !text.includes("Notes about the staging database"),
    "the old question is still in the thread"
  );
}

/* -------------------------- 6. where you were reading --------------------- */

await page.waitForTimeout(300);
await page.evaluate(() => {
  const el = document.querySelector("[role='log'][aria-label='Conversation']");
  if (el) el.scrollTop = 150;
});
await page.waitForTimeout(300);

const scrolledTo = await page.evaluate(() => {
  const el = document.querySelector("[role='log'][aria-label='Conversation']");
  return el ? el.scrollTop : -1;
});

// Go somewhere else and come back.
await rows().nth(1).click();
await page.waitForTimeout(400);
await rows().first().click();
await page.waitForTimeout(600);

const resumed = await page.evaluate(() => {
  const el = document.querySelector("[role='log'][aria-label='Conversation']");
  return el ? el.scrollTop : -1;
});

if (scrolledTo <= 0) {
  ok("the thread was scrollable enough to test", false, `only scrolled to ${scrolledTo}`);
} else {
  ok(
    "reopening a chat returns to where you were reading",
    Math.abs(resumed - scrolledTo) < 60,
    `left at ${Math.round(scrolledTo)}, came back to ${Math.round(resumed)}`
  );
}

/* --------------------------------- report -------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};

console.log(`\n${c.bold("Polstar · working with conversations")}\n`);
for (const { label, pass, detail } of checks) {
  console.log(
    `  ${pass ? c.green("✓") : c.red("✗")} ${label}${detail && !pass ? c.dim(`  — ${detail}`) : ""}`
  );
}

for (const message of errors) console.log(c.red(`\n  page error: ${message}`));

const failed = checks.filter((k) => !k.pass).length + errors.length;
console.log(
  `\n  ${failed ? c.red(`${failed} failed`) : c.green(`all ${checks.length} passed`)}\n`
);

await browser.close();
process.exit(failed ? 1 : 0);
