// The app itself, on a phone.
//
//   npm run dev
//   node verify/phone.mjs
//
// welcome.mjs covers the front door. This covers everything behind it, on the
// screen size most of it will actually be used at. The two are separate because
// the front door needs a Supabase-configured dev server and this doesn't.
//
// It exists because a phone probe of the main screen found the send button, the
// attachment button, the microphone and the menu all at 30–32px, the two
// composer pills at 27px tall, and the message box's tap target at 34px — every
// control anybody touches, under the floor, on a screen that is only ever
// touched. None of that shows up in a screenshot, and none of it shows up in a
// desktop browser, which is where all the other harnesses run.

import { chromium } from "playwright";

const SITE = process.env.SELFLIGHT_URL || "http://localhost:5173/";

const PHONE = { width: 390, height: 844 }; // iPhone 15
const SMALL = { width: 375, height: 667 }; // iPhone SE, the smallest still sold
const TOUCH = 44;
const NO_ZOOM = 16;

const checks = [];
const ok = (label, pass, detail = "") => checks.push({ label, pass: Boolean(pass), detail });
const errors = [];

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {})
});

async function open(viewport, { touch = true } = {}) {
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: touch ? 3 : 1
  });
  const page = await context.newPage();
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
      body: `data: ${JSON.stringify({ text: "A short reply." })}\n\ndata: {"done":true}\n\n`
    });
  });

  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(350);
  return { context, page };
}

// Every visible control, measured — not the handful I remembered to size.
const TOO_SMALL = (floor) => {
  const bad = [];
  for (const el of document.querySelectorAll("button, a, [role='button'], input, textarea, select")) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    // A hidden or off-screen control isn't in anybody's way.
    if (box.bottom < 0 || box.top > innerHeight) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;

    // Two cases where the box that a finger aims at isn't the element's own.
    // Both are marked in the markup rather than guessed at here, so this can
    // only be as generous as the code explicitly asked it to be.
    //
    // `.tap-area` grows an invisible target around a control that keeps its
    // visual size — read the pseudo-element instead of the button.
    const after = getComputedStyle(el, "::after");
    let grown =
      after.content !== "none" && after.position === "absolute"
        ? {
            width: Math.max(box.width, parseFloat(after.width) || 0),
            height: Math.max(box.height, parseFloat(after.height) || 0)
          }
        : box;

    // `.tap-wraps` says the container is the target: it focuses the control
    // inside it on tap, so its size is the one a thumb has to hit.
    const wrapper = el.closest(".tap-wraps");
    if (wrapper && wrapper !== el) {
      const w = wrapper.getBoundingClientRect();
      grown = { width: Math.max(grown.width, w.width), height: Math.max(grown.height, w.height) };
    }

    if (grown.height < floor || grown.width < floor) {
      const name = (el.getAttribute("aria-label") || el.placeholder || el.textContent || el.tagName)
        .trim()
        .slice(0, 26);
      bad.push(`${name} ${Math.round(grown.width)}×${Math.round(grown.height)}`);
    }
  }
  return bad;
};

/* ------------------------------- the composer ----------------------------- */

{
  const { context, page } = await open(PHONE);

  // The one that was wrong for the whole life of the app: `--msg-size` is
  // 15.5px, and anything under 16 makes Safari zoom the page the moment the
  // box is focused. It never zooms back.
  const font = await page
    .locator("textarea")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  ok("the message box doesn't zoom the page", font >= NO_ZOOM, `${font}px`);

  const small = await page.evaluate(TOO_SMALL, TOUCH);
  ok("every control on the main screen is 44px", small.length === 0, small.join(", "));

  // Tapping the padding of the message box looks identical to tapping the box.
  // Until now it did nothing.
  const composer = page.locator("textarea").locator("..");
  const box = await composer.boundingBox();
  await page.touchscreen.tap(box.x + 6, box.y + 4);
  await page.waitForTimeout(150);
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  ok("tapping the edge of the message box focuses it", focused === "TEXTAREA", `focus on ${focused}`);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: innerWidth
  }));
  ok(
    "nothing hangs off the side",
    overflow.doc <= overflow.win + 1,
    `${overflow.doc}px in a ${overflow.win}px window`
  );

  // End to end, by touch only — no keyboard shortcuts, no clicks.
  await page.fill("textarea", "hello from a phone");
  await page.locator("button[aria-label='Send message']").tap();
  await page.waitForTimeout(900);
  const replied = await page.getByText("A short reply.").count();
  ok("a message can be sent by thumb", replied > 0);

  await context.close();
}

/* ----------------------------- with the keyboard -------------------------- */

{
  const { context, page } = await open(PHONE);

  // Roughly what a QWERTY keyboard leaves of a 390×844 screen. The composer is
  // the one thing that must survive it: a chat app whose message box is under
  // the keyboard is a chat app you cannot use.
  await page.setViewportSize({ width: 390, height: 430 });
  await page.waitForTimeout(300);

  const seen = await page.evaluate(() => {
    const el = document.querySelector("textarea");
    const r = el.getBoundingClientRect();
    const send = document.querySelector("button[aria-label='Send message']")?.getBoundingClientRect();
    return {
      boxBottom: r.bottom,
      sendBottom: send?.bottom ?? 0,
      height: innerHeight
    };
  });
  ok(
    "the message box stays above the keyboard",
    seen.boxBottom <= seen.height && seen.boxBottom > 0,
    `bottom at ${Math.round(seen.boxBottom)}px of ${seen.height}px`
  );
  ok(
    "and so does the send button",
    seen.sendBottom <= seen.height && seen.sendBottom > 0,
    `bottom at ${Math.round(seen.sendBottom)}px of ${seen.height}px`
  );

  await context.close();
}

/* ------------------------------- the drawer ------------------------------- */

{
  const { context, page } = await open(PHONE);

  await page.locator("button[aria-label='Show menu']").tap();
  await page.waitForTimeout(400);

  const nav = await page.locator("nav[aria-label='Conversations']:visible").count();
  ok("the menu opens by thumb", nav > 0);

  const small = await page.evaluate(TOO_SMALL, TOUCH);
  ok("every control in the menu is 44px too", small.length === 0, small.join(", "));

  await context.close();
}

/* ------------------------------ the smallest phone ------------------------ */

{
  const { context, page } = await open(SMALL);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: innerWidth
  }));
  ok(
    "an iPhone SE doesn't scroll sideways",
    overflow.doc <= overflow.win + 1,
    `${overflow.doc}px in a ${overflow.win}px window`
  );

  const small = await page.evaluate(TOO_SMALL, TOUCH);
  ok("nothing shrinks below 44px to fit", small.length === 0, small.join(", "));

  await context.close();
}

/* ----------------------- and a mouse keeps the compact one ---------------- */

// The other half of every check above. All of it is gated on a coarse pointer,
// so a laptop should measure smaller — and if it doesn't, the gate isn't doing
// anything and the phone numbers are a coincidence.
{
  const { context, page } = await open({ width: 1300, height: 900 }, { touch: false });

  const sizes = await page.evaluate(() => ({
    send: document.querySelector("button[aria-label='Send message']")?.getBoundingClientRect().height,
    font: parseFloat(getComputedStyle(document.querySelector("textarea")).fontSize)
  }));
  ok(
    "a mouse still gets the compact composer",
    sizes.send > 0 && sizes.send < TOUCH && sizes.font < NO_ZOOM,
    `send ${Math.round(sizes.send)}px, text ${sizes.font}px`
  );

  await context.close();
}

/* --------------------------------- report --------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};

console.log(`\n${c.bold("Polstar · in one hand")}  ${c.dim("iPhone 15, iPhone SE, keyboard up")}\n`);
for (const { label, pass, detail } of checks) {
  console.log(`  ${pass ? c.green("✓") : c.red("✗")} ${label}${detail ? c.dim(`  — ${detail}`) : ""}`);
}
for (const message of errors) console.log(c.red(`\n  page error: ${message}`));

const failed = checks.filter((k) => !k.pass).length + errors.length;
console.log(`\n  ${failed ? c.red(`${failed} failed`) : c.green(`all ${checks.length} passed`)}\n`);

await browser.close();
process.exit(failed ? 1 : 0);
