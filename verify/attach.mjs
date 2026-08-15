// Attaching a file, and whether the model actually receives it.
//
//   npm run dev
//   node verify/attach.mjs
//
// The check that matters is the one on the request body. A chip appearing in
// the composer proves the interface works; only reading what was posted to
// /api/chat proves the file was sent. Those two can come apart, and when they
// do the answer is confidently about a file the model never saw — which is the
// worst possible failure for a feature whose whole point is honesty.

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
    body: JSON.stringify({ provider: "Perplexity", configured: true, connectors: false })
  })
);

// Every message the model was sent, so the file can be looked for in it.
const sent = [];
await page.route("**/api/chat", (route) => {
  const body = route.request().postDataJSON();
  if (body?.task === "title") {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ title: null })
    });
  }
  sent.push(body);
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: `data: ${JSON.stringify({ text: "Read it." })}\n\ndata: {"done":true}\n\n`
  });
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("textarea");

const CSV = "date,amount,note\n2026-01-04,19.99,coffee beans\n2026-01-09,240.00,new keyboard\n";
const file = (name, content, mimeType = "text/plain") => ({
  name,
  mimeType,
  buffer: Buffer.from(content)
});

const input = page.locator("input[type=file]");

/* ------------------------------ attaching one ----------------------------- */

ok("the composer offers a way to attach", (await page.locator("button[aria-label='Attach a file']").count()) > 0);

await input.setInputFiles(file("spending.csv", CSV));
await page.waitForTimeout(400);

ok(
  "the attached file shows as a chip",
  (await page.getByText("spending.csv").count()) > 0
);
ok(
  "the chip says how big it is",
  /\d+\s?(B|KB|MB)/.test(await page.locator(".thread-col").last().innerText())
);

/* --------------------------- removing it again ---------------------------- */

await page.click("button[aria-label='Remove spending.csv']");
await page.waitForTimeout(250);
ok("removing the chip takes the file off", (await page.getByText("spending.csv").count()) === 0);

/* --------------------------- what the model gets -------------------------- */

await input.setInputFiles(file("spending.csv", CSV));
await page.waitForTimeout(400);
await page.fill("textarea", "What did I spend the most on?");
await page.press("textarea", "Enter");
await page.waitForTimeout(1200);

const posted = sent.at(-1);
// The browser posts its own frames — `{ role, text }` — and the server turns
// them into the provider's `{ role, content }`. Reading `.content` here found
// nothing and quietly compared empty strings.
const lastMessage = posted?.messages?.at(-1)?.text || "";

ok("the file's contents reached the model", lastMessage.includes("new keyboard"), lastMessage.slice(0, 160));
ok("the filename reached the model too", lastMessage.includes("spending.csv"));
ok("the question is still in there", lastMessage.includes("What did I spend the most on?"));
ok(
  "the question comes after the file",
  lastMessage.indexOf("new keyboard") < lastMessage.indexOf("What did I spend"),
  "an instruction above a long file is easy to lose"
);

/* ---------------------------- what the thread shows ----------------------- */

const thread = await page.locator(".stack-msg").innerText();
ok("the conversation shows the question", thread.includes("What did I spend the most on?"));
ok(
  "the conversation shows a chip, not the whole file",
  !thread.includes("new keyboard"),
  "the file was inlined into the bubble"
);
ok("the chip is in the thread", thread.includes("spending.csv"));

// The contents did go to the model, so there has to be a way to see them.
await page.locator(".stack-msg").getByRole("button", { name: /spending\.csv/ }).click();
await page.waitForTimeout(300);
ok(
  "opening the chip shows what was actually sent",
  (await page.locator(".stack-msg").innerText()).includes("new keyboard")
);

/* ------------------------ the composer clears itself ---------------------- */

ok(
  "the file doesn't stay attached to the next message",
  (await page.locator("button[aria-label='Remove spending.csv']").count()) === 0
);

/* ------------------------------ what's refused ---------------------------- */

await input.setInputFiles(file("report.pdf", "%PDF-1.7 not really", "application/pdf"));
await page.waitForTimeout(400);

const alert = await page.locator("[role=alert]").allInnerTexts();
ok("a PDF is refused out loud", alert.join(" ").toLowerCase().includes("pdf"), alert.join(" "));
ok(
  "the refusal says what to do instead",
  /paste/i.test(alert.join(" ")),
  alert.join(" ")
);
ok("the PDF isn't attached anyway", (await page.locator("button[aria-label='Remove report.pdf']").count()) === 0);

/* --------------------------- a file with no words ------------------------- */

await page.click("text=New chat");
await page.waitForTimeout(300);
await input.setInputFiles(file("notes.md", "# Standup\n\n- shipped the pricing page\n"));
await page.waitForTimeout(400);

const sendButton = page.locator("button[aria-label='Send message']");
ok("a file on its own can be sent", await sendButton.isEnabled());

const before = sent.length;
await sendButton.click();
await page.waitForTimeout(1200);
ok(
  "sending a file with no question still reaches the model",
  sent.length > before && (sent.at(-1)?.messages?.at(-1)?.text || "").includes("shipped the pricing page")
);

/* -------------------------------- survival -------------------------------- */

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);
const afterReload = await page.locator(".stack-msg").innerText();
ok("the attachment is still there after a reload", afterReload.includes("notes.md"), afterReload.slice(0, 120));

/* --------------------------------- report -------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};

console.log(`\n${c.bold("Polstar · attaching a file")}\n`);
for (const { label, pass, detail } of checks) {
  console.log(
    `  ${pass ? c.green("✓") : c.red("✗")} ${label}${detail && !pass ? c.dim(`  — ${detail}`) : ""}`
  );
}
for (const message of errors) console.log(c.red(`\n  page error: ${message}`));

const failed = checks.filter((k) => !k.pass).length + errors.length;
console.log(`\n  ${failed ? c.red(`${failed} failed`) : c.green(`all ${checks.length} passed`)}\n`);

await browser.close();
process.exit(failed ? 1 : 0);
