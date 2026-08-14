// Can you read the screen?
//
//   npm run dev
//   node verify/contrast.mjs
//
// themes.test.mjs measures the palette objects. This measures the pixels: it
// reads the computed colour of real elements — an actual paragraph, the
// placeholder in the composer, the caveat under it — works out the WCAG ratio
// against whatever is actually behind them, and fails on anything unreadable.
//
// The two differ, and the gap is where this kind of bug lives. A palette can be
// perfect while a component hard-codes a grey, or applies `text-soft` over
// `bg-panel` when the palette only ever checked it against `bg-page`.

import { chromium } from "playwright";

const URL = process.env.SELFLIGHT_URL || "http://localhost:5173/";

// WCAG 2.1: 4.5:1 for body text, 3:1 for large text and meaningful edges,
// 7:1 for AAA — which is what a palette called "High contrast" has to clear.
const AA = 4.5;
const AA_LARGE = 3;
const AAA = 7;

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {})
});

const page = await browser.newPage({ viewport: { width: 1250, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.route("**/api/capabilities", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ provider: "Perplexity", configured: true, connectors: false })
  })
);
await page.route("**/api/chat", (route) => {
  const body = route.request().postDataJSON();
  if (body?.task === "title") {
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"title":null}' });
  }
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: `data: ${JSON.stringify({ text: "A reply with **bold** and `code` in it." })}\n\ndata: {"done":true}\n\n`
  });
});

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("textarea");

// Measured in the page, because the only background that counts is the one
// actually painted behind the element — which may be three ancestors up.
const MEASURE = () => {
  const luminance = ([r, g, b]) => {
    const ch = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const parse = (colour) => (colour.match(/[\d.]+/g) || []).map(Number);

  // Walks up until it finds something actually painted. `transparent` and
  // `rgba(…, 0)` both mean "whatever is behind me".
  const backdrop = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg.length >= 3 && (bg[3] === undefined || bg[3] > 0.95)) return bg.slice(0, 3);
    }
    return parse(getComputedStyle(document.body).backgroundColor).slice(0, 3);
  };

  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const of = (el) => {
    if (!el) return null;
    const fg = parse(getComputedStyle(el).color).slice(0, 3);
    return Math.round(ratio(fg, backdrop(el)) * 100) / 100;
  };

  const byText = (tag, starts) =>
    [...document.querySelectorAll(tag)].find((n) => n.textContent.trim().startsWith(starts));

  const composer = document.querySelector("textarea");
  const placeholder = composer
    ? (() => {
        // ::placeholder can't be read off a computed style, so the class it
        // comes from is resolved instead: placeholder:text-soft.
        const soft = getComputedStyle(document.documentElement).getPropertyValue("--soft").trim();
        const fg = soft.split(/\s+/).map(Number);
        return Math.round(ratio(fg, backdrop(composer)) * 100) / 100;
      })()
    : null;

  // Small pills are the easiest thing to get wrong, because they set their own
  // background and the palette was only ever checked against the page.
  // Must have text in it. The first version matched the decorative dot on each
  // chat row — a 6px circle with no content — and measured its inherited colour
  // against its own background, which is a number that means nothing and never
  // moved when the real badge was fixed.
  const badge = [...document.querySelectorAll("nav span[class*='rounded-full']")].find(
    (el) => el.textContent.trim().length > 0
  );
  const segment = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "Code"
  );

  return {
    reply: of([...document.querySelectorAll(".stack-msg p")].pop()),
    sidebarBadge: of(badge),
    modeSwitch: of(segment),
    yourMessage: of(document.querySelector(".stack-msg div[class*='bg-bubble']")),
    code: of(document.querySelector(".stack-msg code")),
    sidebarChat: of(document.querySelector("nav[aria-label='Conversations'] button span:nth-child(2)")),
    sidebarHeading: of(byText("p", "TODAY") || byText("p", "Today")),
    caveat: of(byText("span", "Selflight can be wrong")),
    composerPlaceholder: placeholder,
    modelPicker: of(byText("button", "Iris"))
  };
};

const checks = [];
const ok = (label, pass, detail = "") => checks.push({ label, pass: Boolean(pass), detail });

const FLOORS = {
  reply: AA,
  yourMessage: AA,
  code: AA,
  sidebarChat: AA,
  sidebarHeading: AA_LARGE,
  caveat: AA_LARGE,
  composerPlaceholder: AA_LARGE,
  modelPicker: AA_LARGE,
  sidebarBadge: AA_LARGE,
  modeSwitch: AA
};

async function measure(label, settings, { floor = null } = {}) {
  await page.evaluate((s) => localStorage.setItem("selflight.settings.v1", JSON.stringify(s)), settings);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");

  // One conversation, so there's a reply and a sidebar row to measure.
  if (!(await page.locator("nav[aria-label='Conversations'] button").count())) {
    await page.fill("textarea", "hello there");
    await page.press("textarea", "Enter");
    await page.waitForTimeout(900);
  } else {
    await page.locator("nav[aria-label='Conversations'] button").first().click();
    await page.waitForTimeout(500);
  }

  const found = await page.evaluate(MEASURE);
  const rows = [];
  for (const [key, value] of Object.entries(found)) {
    if (value === null) continue;
    const need = floor ?? FLOORS[key];
    rows.push({ key, value, need, pass: value >= need });
  }
  const worst = rows.reduce((a, r) => (r.value < a.value ? r : a), rows[0]);
  const failed = rows.filter((r) => !r.pass);

  ok(
    label,
    failed.length === 0,
    failed.length
      ? failed.map((r) => `${r.key} ${r.value}:1 (needs ${r.need})`).join(", ")
      : `worst ${worst.key} ${worst.value}:1`
  );
  return { rows, worst };
}

/* ------------------------------ every palette ----------------------------- */

const PALETTES = ["paper", "slate", "focus", "midnight", "nocturne", "contrast", "contrast-dark"];
const table = [];

for (const theme of PALETTES) {
  const { worst } = await measure(`${theme} is readable`, { theme });
  table.push([theme, worst]);
}

/* ---------------------- high contrast holds its ground -------------------- */

// AAA, not AA. Anything less and the name is a lie.
await measure("High contrast clears AAA on real elements", { theme: "contrast" }, { floor: AAA });
await measure("High contrast dark clears AAA too", { theme: "contrast-dark" }, { floor: AAA });

// The two controls that used to quietly undo it.
await measure(
  "a main colour can't dilute High contrast",
  { theme: "contrast", baseColor: "#3B6EA5" },
  { floor: AAA }
);
await measure(
  "an accent can't dilute High contrast",
  { theme: "contrast", accent: "blue", accentCustom: "#84AACC" },
  { floor: AAA }
);

/* ----------------- and the controls still work where they should ---------- */

const tint = await page.evaluate(async () => {
  localStorage.setItem("selflight.settings.v1", JSON.stringify({ theme: "paper", baseColor: "#3B6EA5" }));
  return true;
});
if (tint) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(300);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok("a main colour still recolours a normal palette", bg === "rgb(59, 110, 165)", bg);
}

await page.evaluate(() =>
  localStorage.setItem("selflight.settings.v1", JSON.stringify({ theme: "paper", accent: "blue" }))
);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("textarea");
await page.waitForTimeout(300);
const accent = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
);
ok("an accent still overrides a normal palette", accent === "44 104 180", accent);

/* -------------------- what a fresh browser actually ships ----------------- */

await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("textarea");
await page.waitForTimeout(300);
const shipped = await page.evaluate(() => ({
  page: getComputedStyle(document.documentElement).getPropertyValue("--page").trim(),
  ink: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim()
}));
ok(
  "a new browser opens in High contrast",
  shipped.page === "255 255 255" && shipped.ink === "0 0 0",
  `page ${shipped.page}, ink ${shipped.ink}`
);

/* --------------------------------- report -------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};

console.log(`\n${c.bold("Selflight · can you read it")}  ${c.dim("measured on rendered elements")}\n`);
console.log(c.dim("  palette         worst element                  ratio"));
for (const [theme, worst] of table) {
  console.log(`  ${theme.padEnd(16)}${worst.key.padEnd(30)} ${String(worst.value).padStart(6)}:1`);
}
console.log();
for (const { label, pass, detail } of checks) {
  console.log(`  ${pass ? c.green("✓") : c.red("✗")} ${label}${detail ? c.dim(`  — ${detail}`) : ""}`);
}
for (const message of errors) console.log(c.red(`\n  page error: ${message}`));

const failed = checks.filter((k) => !k.pass).length + errors.length;
console.log(`\n  ${failed ? c.red(`${failed} failed`) : c.green(`all ${checks.length} passed`)}\n`);

await browser.close();
process.exit(failed ? 1 : 0);
