// Proves the composer acts on instructions rather than only parsing them.
//
// commands.test.mjs checks the parser reads a sentence correctly. This checks
// the app then does the thing: real pixels change, the message doesn't get
// sent, Undo puts it back, and a question still reaches the model.
//
//   npm run dev                     # in one terminal
//   node verify/commands.mjs        # in another
//
// Runs against a stubbed model, so it needs no API key.

import { chromium } from "playwright";

const URL = process.env.SELFLIGHT_URL || "http://localhost:5173/";

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {})
});

const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

const failures = [];
page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

let modelCalls = 0;

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
      body: JSON.stringify({ title: "A real answer" })
    });
  }
  modelCalls++;
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: `data: ${JSON.stringify({ text: "An answer from the model." })}\n\ndata: {"done":true}\n\n`
  });
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("textarea");

/* -------------------------------- helpers -------------------------------- */

const say = async (text) => {
  await page.fill("textarea", text);
  await page.press("textarea", "Enter");
  // Long enough for a state update; a model call would take far longer.
  await page.waitForTimeout(350);
};

const background = () =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const banner = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find(
      (d) => d.className.includes("rise") && d.textContent.includes("Send as a message")
    );
    return el ? el.textContent.replace(/UndoSend as a message/, "").trim() : null;
  });

const messageCount = () =>
  page.evaluate(() => document.querySelector(".stack-msg")?.children.length ?? 0);

const fontSize = () =>
  page.evaluate(() => getComputedStyle(document.querySelector(".thread-col")).getPropertyValue("--msg-size"));

const report = [];
function check(label, passed, detail) {
  report.push({ label, passed, detail });
  if (!passed) failures.push(label);
}

/* --------------------------------- checks -------------------------------- */

// 1. The sentence the whole feature exists for.
const before = await background();
await say("hey I want this LLM to be a tan color background");
const after = await background();

check("a spoken-style colour instruction repaints the app", before !== after, `${before} → ${after}`);
check("it says what it did", /tan/i.test((await banner()) || ""), await banner());
check("it did not send a message", (await messageCount()) === 0, `${await messageCount()} messages`);
check("it did not call the model", modelCalls === 0, `${modelCalls} calls`);

// 2. Undo really undoes.
await page.click("text=Undo");
await page.waitForTimeout(250);
check("Undo restores the previous colours", (await background()) === before, `${await background()}`);

// 3. A relative change reads the current value.
const sizeBefore = await fontSize();
await say("bigger text");
const sizeBigger = await fontSize();
check("bigger text moves the type scale", sizeBefore !== sizeBigger, `${sizeBefore} → ${sizeBigger}`);

await say("smaller text");
await say("smaller text");
check("smaller text moves it back down", (await fontSize()) !== sizeBigger, await fontSize());

// 4. Navigation.
await say("open the appearance settings");
const panelOpen = await page.evaluate(
  () => !!document.querySelector('button[aria-current="true"]')
);
check("open appearance opens the panel", panelOpen);

await say("close settings");
await page.waitForTimeout(250);
check(
  "close settings closes it",
  !(await page.evaluate(() => !!document.querySelector('button[aria-current="true"]')))
);

// 5. A real question is not eaten.
await say("What is a good colour for a reading app?");
await page.waitForTimeout(700);
check("a question still reaches the model", modelCalls === 1, `${modelCalls} calls`);
check("and appears in the thread", (await messageCount()) >= 2, `${await messageCount()} messages`);

// 6. The escape hatch sends a mis-read message after all.
await page.fill("textarea", "make the background tan");
await page.press("textarea", "Enter");
await page.waitForTimeout(300);
const tinted = await background();
await page.click("text=Send as a message");
await page.waitForTimeout(700);

check("Send as a message reaches the model", modelCalls === 2, `${modelCalls} calls`);
check("and reverses the change it made", (await background()) !== tinted, await background());

/* --------------------------------- output -------------------------------- */

console.log("\nSelflight · commands from the composer\n");
for (const { label, passed, detail } of report) {
  console.log(`  ${passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${detail ? `\x1b[2m  ${detail}\x1b[0m` : ""}`);
}

await browser.close();

console.log();
if (failures.length) {
  console.log(`\x1b[31m${failures.length} failed\x1b[0m\n`);
  process.exit(1);
}
console.log(`\x1b[32mAll ${report.length} checks passed.\x1b[0m\n`);
