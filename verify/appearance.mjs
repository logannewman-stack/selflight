// Proves every appearance control changes real rendered output — not just a CSS
// variable, and not a placeholder button.
//
// For each setting it reads the computed style of an actual element (a
// paragraph, the composer, a code block) before and after, and additionally
// hashes a screenshot of the conversation to confirm the pixels moved.
//
//   npm run dev                     # in one terminal
//   npx playwright install chromium # once
//   node verify/appearance.mjs      # in another
//
// Runs against a stubbed model reply, so it needs no API key.

import crypto from "node:crypto";
import { chromium } from "playwright";

const URL = process.env.SELFLIGHT_URL || "http://localhost:5173/";

const REPLY = `## A heading

A paragraph of body text.

A second one, for measuring the gap.

\`\`\`javascript
const a = 1;
\`\`\``;

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {})
});

const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

const failures = [];
page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

// Without a key the app shows its setup screen instead of the chat, which is
// right for a person and wrong for this suite — it measures the interface, so
// it says a model is configured and stubs the model itself.
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
      body: JSON.stringify({ title: "Measuring the interface" })
    });
  }
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: `data: ${JSON.stringify({ text: REPLY })}\n\ndata: {"done":true}\n\n`
  });
});

/* ------------------------------ measurement ----------------------------- */

// Computed styles of real elements. If a control were decorative, these would
// not budge.
const probe = () =>
  page.evaluate(() => {
    const pick = (selector) => document.querySelector(selector);
    const cs = (el, prop) => (el ? getComputedStyle(el)[prop] : null);

    const reply = pick(".font-reading");
    const paragraph = reply?.querySelector("p");
    const heading = reply?.querySelector("h2");
    const codeEl = pick("pre code");
    const composer = pick("textarea")?.closest("div");
    const stack = pick(".stack-msg");
    const column = pick(".thread-col");

    // Vertical distance between two consecutive messages.
    let gap = null;
    if (stack && stack.children.length > 1) {
      const a = stack.children[0].getBoundingClientRect();
      const b = stack.children[1].getBoundingClientRect();
      gap = Math.round((b.top - a.bottom) * 10) / 10;
    }

    const userBubble = [...document.querySelectorAll("div")].find(
      (d) => d.textContent === "Measure this interface" && d.children.length === 0
    );

    const accentEl = pick(".bg-accent");

    return {
      pageBackground: cs(document.body, "backgroundColor"),
      sidebarBackground: cs(pick(".bg-panel"), "backgroundColor"),
      accentColour: cs(accentEl, "backgroundColor"),
      uiFont: cs(document.body, "fontFamily").split(",")[0].replace(/"/g, ""),
      replyFont: cs(reply, "fontFamily").split(",")[0].replace(/"/g, ""),
      codeFont: cs(codeEl, "fontFamily").split(",")[0].replace(/"/g, ""),
      textSize: cs(reply, "fontSize"),
      lineHeight: cs(reply, "lineHeight"),
      letterSpacing: cs(reply, "letterSpacing"),
      fontWeight: cs(reply, "fontWeight"),
      paragraphGap: cs(paragraph, "marginBottom"),
      headingSize: cs(heading, "fontSize"),
      codeSize: cs(codeEl, "fontSize"),
      codeWhitespace: cs(codeEl, "whiteSpace"),
      composerRadius: cs(composer, "borderRadius"),
      messageGap: gap,
      columnWidth: column?.clientWidth ?? null,
      bubbleBackground: cs(userBubble, "backgroundColor"),
      gutter: !!pick("pre")?.parentElement && pick("pre").parentElement.children.length === 2
    };
  });

const shot = async () => {
  const buffer = await page.screenshot();
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12);
};

let report = [];

async function verify(label, field, act, { pixelsOptional = false } = {}) {
  const before = await probe();
  const beforeShot = await shot();

  await act();
  await page.waitForTimeout(650);

  const after = await probe();
  const afterShot = await shot();

  const changed = before[field] !== after[field];
  const repainted = beforeShot !== afterShot;
  const pass = changed && (repainted || pixelsOptional);

  if (!pass) {
    failures.push(
      `${label}: ${field} ${changed ? "changed" : `did NOT change (${after[field]})`}, pixels ${
        repainted ? "changed" : "did NOT change"
      }${pixelsOptional ? " (pixel check optional here)" : ""}`
    );
  }

  report.push({
    setting: label,
    measured: field,
    before: String(before[field]),
    after: String(after[field]),
    pixels: repainted ? "changed" : "same",
    result: pass ? "PASS" : "FAIL"
  });
}

/* -------------------------------- the run ------------------------------- */

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// If the app isn't what loaded, say so plainly — an HTTP proxy that swallows
// localhost produces its own page here, and thirty seconds of "element not
// found" is a poor way to learn that.
if (!(await page.locator("textarea").count())) {
  const body = (await page.locator("body").innerText()).slice(0, 200).replace(/\s+/g, " ");
  throw new Error(`No composer at ${URL} — is \`npm run dev\` running? Page says: ${body}`);
}

await page.getByPlaceholder(/Message Selflight/).fill("Measure this interface");
await page.getByLabel("Send message").click();
await page.waitForTimeout(1500);

await page.getByRole("button", { name: "Settings" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Appearance" }).click();
await page.waitForTimeout(400);

const group = (heading) => page.locator("p", { hasText: heading }).locator("..");
const clickIn = (heading, name) =>
  group(heading).getByRole("button", { name, exact: true }).click();

// Colour
await verify("Palette", "pageBackground", async () => {
  await page.getByRole("button", { name: /^Nocturne Near-black/ }).click();
});
await verify("Accent", "accentColour", () => page.getByLabel("Accent: Violet").click());

// Any colour, not just the nine presets.
await verify("Custom accent", "accentColour", () =>
  page.getByLabel("Accent: custom").fill("#00B894")
);

// One pick re-derives every surface and text colour, and a dark enough choice
// flips the whole app to a dark theme — so this checks the sidebar moved too,
// not just the page behind it.
await verify("Main colour", "pageBackground", async () => {
  const hex = page.getByLabel("Main colour, as hex");
  await hex.fill("#123A5E");
  await hex.press("Enter");
});
await verify("Main colour · derived surfaces", "sidebarBackground", async () => {
  const hex = page.getByLabel("Main colour, as hex");
  await hex.fill("#F6EBD9");
  await hex.press("Enter");
});

// Typefaces. A newly-chosen face has to be fetched before it paints, so the
// computed family changes a beat before the pixels do — wait for the font to
// actually land, or the pixel check races it.
const face = (label, name) => async () => {
  const picker = group(new RegExp(`^${label}$`));
  await picker.getByRole("button", { name: /Change|Close/ }).click();
  await page.waitForTimeout(1400);
  await picker.getByRole("button", { name: new RegExp(`^${name}`) }).click();

  await page.evaluate(
    (family) => document.fonts.load(`16px "${family}"`).then(() => document.fonts.ready),
    name
  );
  await page.waitForTimeout(500);
};
await verify("Interface typeface", "uiFont", face("Interface", "Atkinson Hyperlegible"));
await verify("Reply typeface", "replyFont", face("Replies", "Literata"));
await verify("Code typeface", "codeFont", face("Code", "JetBrains Mono"));

// Typography
await verify("Text size", "textSize", () => clickIn(/^Text size$/, "Extra large"));
await verify("Weight", "fontWeight", () => clickIn(/^Weight$/, "Medium"));
await verify("Line spacing", "lineHeight", () => clickIn(/^Line spacing$/, "Relaxed"));
await verify("Letter spacing", "letterSpacing", () => clickIn(/^Letter spacing$/, "Wider"));
await verify("Paragraph spacing", "paragraphGap", () => clickIn(/^Paragraph spacing$/, "Loose"));
await verify("Heading size", "headingSize", () => clickIn(/^Heading size$/, "Loud"));

// Layout
await verify("Density", "messageGap", () => clickIn(/^Density$/, "Spacious"));
await verify("Conversation width", "columnWidth", () => clickIn(/^Conversation width$/, "Narrow"));
await verify("Corners", "composerRadius", () => clickIn(/^Corners$/, "Square"));
await verify("Your messages", "bubbleBackground", () => clickIn(/^Your messages$/, "Plain"));

// Code
await verify("Code size", "codeSize", () => clickIn(/^Code size$/, "Large"));
await verify("Line numbers", "gutter", async () => {
  await page.getByLabel("Line numbers").click();
});
await verify("Wrap long lines", "codeWhitespace", async () => {
  await page.getByLabel("Wrap long lines").click();
});

/* -------------------------------- results ------------------------------- */

const width = (key, min) =>
  Math.max(min, ...report.map((r) => String(r[key]).length));
const cols = [
  ["setting", width("setting", 7)],
  ["measured", width("measured", 8)],
  ["before", Math.min(width("before", 6), 26)],
  ["after", Math.min(width("after", 5), 26)],
  ["pixels", 7],
  ["result", 6]
];

const line = (row) =>
  cols.map(([key, w]) => String(row[key]).slice(0, w).padEnd(w)).join("  ");

console.log(line(Object.fromEntries(cols.map(([k]) => [k, k.toUpperCase()]))));
console.log(cols.map(([, w]) => "-".repeat(w)).join("  "));
for (const row of report) console.log(line(row));

console.log(
  `\n${report.filter((r) => r.result === "PASS").length}/${report.length} controls changed both a real computed style and the rendered pixels.`
);
if (failures.length) console.log(`\nFAILURES:\n- ${failures.join("\n- ")}`);

await browser.close();
process.exit(failures.length ? 1 : 0);
