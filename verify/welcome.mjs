// The front door, measured.
//
//   VITE_SUPABASE_URL=https://example.supabase.co \
//   VITE_SUPABASE_ANON_KEY=anon npm run dev
//   node verify/welcome.mjs
//
// Both env vars have to be set or `hasSupabase` is false and the app skips
// straight past the landing page and the sign-in form — the harness would then
// pass by never reaching what it was written to test, which is the failure mode
// worth being loudest about. It refuses to run instead.
//
// What this actually checks is ergonomics, not appearance. A screenshot proves
// a screen exists; it does not prove the button is inside thumb reach, that the
// text boxes are the 16px that stops Safari zooming the page, that nothing is
// under 44px, or that the form is still usable once the keyboard has eaten half
// the screen. Those are numbers, so they get asserted as numbers.

import { chromium } from "playwright";

const SITE = process.env.SELFLIGHT_URL || "http://localhost:5173/";

const PHONE = { width: 390, height: 844 }; // iPhone 15, portrait
const LAPTOP = { width: 1300, height: 900 };
// What's left of the phone once the keyboard is up. Measured on iOS: a 390×844
// screen leaves roughly 430px of page above a QWERTY keyboard.
const KEYBOARD = { width: 390, height: 430 };

// WCAG 2.1. 4.5:1 for body text, 3:1 for large text and hints.
const AA = 4.5;
const AA_LARGE = 3;
// The floor below which a thumb starts missing. Apple says 44, Google says 48.
const TOUCH = 44;
// The size below which iOS Safari zooms the whole page when a field is focused.
const NO_ZOOM = 16;

const checks = [];
const ok = (label, pass, detail = "") => checks.push({ label, pass: Boolean(pass), detail });

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {})
});

const errors = [];

async function open({ viewport, touch = false, theme = null }) {
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

  // Seeded before the app reads it, because it reads it synchronously on the
  // first render. Nothing is cleared here: a new context starts with empty
  // storage anyway, and an init script runs again on every navigation — the
  // first draft wiped the landing flag on reload and then reported the app had
  // failed to remember it. The harness was the bug.
  if (theme) {
    await context.addInitScript(
      ([key, value]) => {
        try {
          localStorage.setItem(key, value);
        } catch {}
      },
      ["selflight.settings.v1", JSON.stringify({ theme })]
    );
  }

  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  return { context, page };
}

const landingUp = (page) => page.locator("h1", { hasText: "tells you the truth" });
const signInUp = (page) => page.locator("input[type='email']");

// Measuring a page mid-animation measures a page that doesn't exist. Waits for
// every running animation to finish rather than for a guessed number of ms.
const settle = (page) =>
  page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})))
  );

/* ------------------------- is the gate even reached? ---------------------- */

{
  const { context, page } = await open({ viewport: LAPTOP });
  const found = await landingUp(page)
    .waitFor({ timeout: 6000 })
    .then(() => true)
    .catch(() => false);

  if (!found) {
    const composer = await page.locator("textarea").count();
    console.error(
      composer
        ? "\n  The app went straight to the chat screen, so the sign-in gate never ran.\n" +
            "  Start the dev server with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set.\n"
        : `\n  Nothing rendered at ${SITE}. Is the dev server up?\n`
    );
    await context.close();
    await browser.close();
    process.exit(2);
  }
  await context.close();
}

/* ------------------------- the landing page, phone ------------------------ */

{
  const { context, page } = await open({ viewport: PHONE, touch: true });
  await landingUp(page).waitFor();

  const hint = await page.locator("p", { hasText: "anywhere to continue" }).first().innerText();
  ok("a phone is told to tap, not click", hint.trim() === "Tap anywhere to continue", hint.trim());

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth
  }));
  ok(
    "nothing hangs off the side of a phone",
    overflow.doc <= overflow.win + 1,
    `${overflow.doc}px wide in a ${overflow.win}px window`
  );

  // The pitch should land in one screen. It's allowed to scroll — the layout
  // survives it — but needing to scroll to find out what the product is
  // defeats the point of a one-claim page.
  //
  // Settled first. The entrance animation starts each line 5px low, so
  // measuring the moment the heading appears reports a page 5px taller than
  // the one that exists a quarter of a second later — which is exactly the
  // failure this printed the first time it ran.
  await settle(page);
  const fits = await page.evaluate(() => {
    const el = document.querySelector("[aria-label='Continue to sign in']");
    return { need: el.scrollHeight, have: el.clientHeight };
  });
  ok(
    "the whole pitch fits one phone screen",
    fits.need <= fits.have,
    `${fits.need}px of content in ${fits.have}px`
  );

  // The claim of the page: tap anywhere at all.
  await page.tap("body", { position: { x: 60, y: 700 } });
  const arrived = await signInUp(page)
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  ok("tapping a blank corner opens sign in", arrived);

  // Seen once, and then never again — somebody signed out wants the form.
  await page.reload({ waitUntil: "domcontentloaded" });
  const straight = await signInUp(page)
    .waitFor({ timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  ok("a second visit skips the pitch", straight);

  await context.close();
}

/* ----------------------- the landing page, small phone -------------------- */

// An iPhone SE cannot fit the pitch, and that is fine — what is not fine is
// clipping it. The first draft was `overflow-hidden` with `onTouchStart`, which
// meant the bottom of the page was unreachable and any attempt to swipe towards
// it left for the sign-in form instead. So: it has to scroll, and scrolling
// must not count as a tap.
{
  // Short enough that the pitch genuinely doesn't fit — a phone in landscape,
  // or a browser with a toolbar and a keyboard both showing.
  const { context, page } = await open({ viewport: { width: 375, height: 560 }, touch: true });
  await landingUp(page).waitFor();
  await settle(page);

  const scroll = await page.evaluate(() => {
    const el = document.querySelector("[aria-label='Continue to sign in']");
    el.scrollTop = el.scrollHeight;
    return { top: el.scrollTop, need: el.scrollHeight, have: el.clientHeight };
  });
  ok(
    "a short screen can still reach the bottom",
    scroll.need > scroll.have && scroll.top > 0,
    scroll.need <= scroll.have
      ? "nothing to scroll — pick a shorter viewport, this check proved nothing"
      : `scrolled ${Math.round(scroll.top)}px of ${scroll.need - scroll.have}px`
  );

  // A swipe is not a tap. Dispatched through the browser's real touch pipeline
  // rather than with the mouse, because a mouse down-move-up fires a click no
  // matter how far it travelled — testing it that way proves nothing about a
  // finger. This is the check `onTouchStart` could never have passed.
  await page.evaluate(() => {
    document.querySelector("[aria-label='Continue to sign in']").scrollTop = 0;
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 187, y: 430 }]
  });
  for (const y of [400, 350, 300, 250, 200]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 187, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);

  ok("a swipe isn't mistaken for a tap", (await landingUp(page).count()) === 1);

  // And a real tap still works on the same screen, so the check above can't
  // pass just because the page stopped responding to touch altogether.
  await page.touchscreen.tap(187, 430);
  const arrived = await signInUp(page)
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  ok("but a tap on the same spot does open sign in", arrived);

  await context.close();
}

/* -------------------- the landing page, laptop and keys ------------------- */

{
  const { context, page } = await open({ viewport: LAPTOP });
  await landingUp(page).waitFor();

  const hint = await page.locator("p", { hasText: "anywhere to continue" }).first().innerText();
  ok("a laptop is told to click", hint.trim() === "Click anywhere to continue", hint.trim());

  // A page you can only leave with a mouse is a page some people cannot leave.
  await page.keyboard.press("Enter");
  const arrived = await signInUp(page)
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  ok("a keypress opens sign in too", arrived);

  await context.close();
}

/* --------------------------- can you read any of it? ---------------------- */

// Measured on the palettes with the least room, not on the one that ships.
// High contrast passes everything by construction; Paper, Slate, Focus and
// Midnight are where a dim line shows up.
//
// Installed into the page once and used by both halves, so the landing page
// and the sign-in card can't drift into two slightly different definitions of
// a contrast ratio.
const MEASURE = () => {
  const luminance = ([r, g, b]) => {
    const ch = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const parse = (colour) => (colour.match(/[\d.]+/g) || []).map(Number);

  const blend = (fg, bg) => {
    const a = fg[3] === undefined ? 1 : fg[3];
    return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
  };

  // Walks up until it finds something actually painted, because the background
  // that counts may be three ancestors away — and on the sign-in card it is.
  const backdrop = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg.length >= 3 && (bg[3] === undefined || bg[3] > 0.95)) return bg.slice(0, 3);
    }
    return parse(getComputedStyle(document.body).backgroundColor).slice(0, 3);
  };

  window.__ratio = (el) => {
    if (!el) return null;
    const back = backdrop(el);
    // Opacity matters: `text-soft/70` is a different colour from `text-soft`,
    // and it was the difference between 3.3:1 and 2.3:1 on the one line that
    // tells people how to get in.
    const front = blend(parse(getComputedStyle(el).color), back);
    const [hi, lo] = [luminance(front), luminance(back)].sort((a, b) => b - a);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };

  window.__byText = (tag, has) =>
    [...document.querySelectorAll(tag)].find((n) => n.textContent.includes(has));
};

const LANDING = () => ({
  headline: window.__ratio(document.querySelector("h1")),
  pitch: window.__ratio(window.__byText("p", "Most assistants")),
  claim: window.__ratio(window.__byText("li", "doesn't know")),
  hint: window.__ratio(window.__byText("p", "anywhere to continue")),
  subhint: window.__ratio(window.__byText("p", "Create an account"))
});

// The card puts all of this on `surface` rather than `page` — a background the
// palettes were tuned against but which nothing has ever been measured on.
const CARD = () => ({
  heading: window.__ratio(document.querySelector("h1")),
  blurb: window.__ratio(window.__byText("p", "pick up where")),
  label: window.__ratio(window.__byText("span", "Email")),
  button: window.__ratio(document.querySelector("button[type='submit']")),
  swap: window.__ratio(window.__byText("button", "Create an account")),
  back: window.__ratio(window.__byText("button", "Back"))
});

// Every line on the landing page is body text, including the two at the bottom
// that say how to get in. AA_LARGE is for decoration and placeholders, and none
// of it is either — so the floor is AA throughout, and the palette has to meet
// it rather than the floor being lowered to whatever currently passes.
const LANDING_FLOORS = { headline: AA, pitch: AA, claim: AA, hint: AA, subhint: AA };
// The card's heading is 33px, which is "large" by WCAG's definition. Everything
// else on it is body text or a control label, and gets the full 4.5.
const CARD_FLOORS = { heading: AA_LARGE, blurb: AA, label: AA, button: AA, swap: AA, back: AA };

const contrastTable = [];

const grade = (label, found, floors, expect) => {
  const rows = Object.entries(found)
    .filter(([, v]) => v !== null)
    .map(([key, value]) => ({ key, value, need: floors[key], pass: value >= floors[key] }));
  const failed = rows.filter((r) => !r.pass);
  const worst = rows.reduce((a, r) => (r.value < a.value ? r : a), rows[0]);

  // A missing element is a failure, not a skip. Five checks that silently
  // became three is how a suite starts passing by measuring nothing.
  ok(
    label,
    rows.length === expect && failed.length === 0,
    rows.length !== expect
      ? `only found ${rows.length} of ${expect} elements — the selectors have drifted`
      : failed.length
        ? failed.map((r) => `${r.key} ${r.value}:1 (needs ${r.need})`).join(", ")
        : `worst ${worst.key} ${worst.value}:1`
  );
  return worst;
};

for (const theme of ["paper", "focus", "slate", "midnight"]) {
  const { context, page } = await open({ viewport: LAPTOP, theme });
  await landingUp(page).waitFor();
  await settle(page);

  await page.evaluate(MEASURE);
  const worstLanding = grade(
    `the landing page is readable in ${theme}`,
    await page.evaluate(LANDING),
    LANDING_FLOORS,
    5
  );

  await page.click("body", { position: { x: 650, y: 450 } });
  await signInUp(page).waitFor();
  await settle(page);

  await page.evaluate(MEASURE);
  const worstCard = grade(
    `the sign-in card is readable in ${theme}`,
    await page.evaluate(CARD),
    CARD_FLOORS,
    6
  );

  contrastTable.push([theme, worstLanding, worstCard]);
  await context.close();
}

/* ---------------------------- sign in, on a phone ------------------------- */

{
  const { context, page } = await open({ viewport: PHONE, touch: true });
  await landingUp(page).waitFor();
  await page.tap("body", { position: { x: 195, y: 500 } });
  await signInUp(page).waitFor();
  await page.waitForTimeout(200);

  const email = page.locator("input[type='email']");
  const password = page.locator("input[type='password']");
  const submit = page.locator("button[type='submit']");

  // The one that decides whether typing an email is pleasant or maddening on
  // iOS: under 16px and Safari zooms the page, and the page never zooms back.
  for (const [name, field] of [["email", email], ["password", password]]) {
    const size = await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    ok(`the ${name} box doesn't zoom the page`, size >= NO_ZOOM, `${size}px`);

    const box = await field.boundingBox();
    ok(`the ${name} box is big enough to hit`, box.height >= 52, `${Math.round(box.height)}px tall`);
  }

  // The whole reason the layout is bottom-weighted. Centred, this lands around
  // 45% — above where a thumb rests and under the keyboard once it opens.
  const view = page.viewportSize();
  const button = await submit.boundingBox();
  const centre = (button.y + button.height / 2) / view.height;
  ok(
    "the button is inside thumb reach",
    centre >= 0.6,
    `centre at ${Math.round(centre * 100)}% down the screen`
  );

  // Everything you can press, not just the ones I remembered to size.
  const small = await page.evaluate((floor) => {
    const bad = [];
    for (const el of document.querySelectorAll("button, a, [role='button']")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < floor || r.width < floor) {
        bad.push(`${(el.getAttribute("aria-label") || el.textContent).trim().slice(0, 24)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return bad;
  }, TOUCH);
  ok("every control is at least 44px", small.length === 0, small.join(", "));

  const keyboard = await email.evaluate((el) => ({
    mode: el.inputMode,
    complete: el.autocomplete,
    caps: el.getAttribute("autocapitalize"),
    correct: el.getAttribute("autocorrect")
  }));
  ok(
    "the email box opens the right keyboard",
    keyboard.mode === "email" &&
      keyboard.complete === "email" &&
      keyboard.caps === "none" &&
      keyboard.correct === "off",
    JSON.stringify(keyboard)
  );

  // Typing a password blind on a phone is how people lock themselves out of an
  // account they created ninety seconds ago.
  await password.fill("hunter22");
  await page.tap("button[aria-label='Show password']");
  const shown = await page.locator("input[value='hunter22']").getAttribute("type");
  ok("the password can be shown", shown === "text", `type=${shown}`);

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth
  }));
  ok(
    "the form doesn't hang off the side",
    overflow.doc <= overflow.win + 1,
    `${overflow.doc}px wide in a ${overflow.win}px window`
  );

  /* --------------------- and now with the keyboard up ------------------- */

  // The test the centred layout failed: half the screen gone, is the button
  // still reachable? A centred card with `overflow-hidden` clips it away with
  // no way to scroll to it, and the form becomes impossible to submit.
  await page.setViewportSize(KEYBOARD);
  await page.waitForTimeout(250);

  const reach = await page.evaluate(() => {
    const el = document.querySelector("button[type='submit']");
    const scroller = [...document.querySelectorAll("div")].find(
      (d) => d.scrollHeight > d.clientHeight + 1 && d.contains(el)
    );
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    else window.scrollTo(0, document.body.scrollHeight);
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: window.innerHeight, scrolled: Boolean(scroller) };
  });
  ok(
    "the button survives the keyboard opening",
    reach.bottom <= reach.height + 1 && reach.top >= 0,
    `${Math.round(reach.top)}–${Math.round(reach.bottom)}px in ${reach.height}px${
      reach.scrolled ? ", after scrolling" : ""
    }`
  );

  await context.close();
}

/* ------------------------- sign in, the other modes ----------------------- */

{
  const { context, page } = await open({ viewport: LAPTOP });
  await landingUp(page).waitFor();
  await page.click("body", { position: { x: 650, y: 450 } });
  await signInUp(page).waitFor();
  await page.waitForTimeout(250);

  // A keyboard is already on screen here, so focusing the field costs nothing.
  // On a phone it would throw the keyboard up over the page before anybody has
  // read what they're signing into, which is why it's width-gated.
  const focused = await page.evaluate(() => document.activeElement?.type);
  ok("a laptop starts in the email box", focused === "email", `focus on ${focused}`);

  // The other half of the anti-zoom check. A laptop has a fine pointer, so it
  // gets the design size — and that difference is the proof the phone's 16px
  // comes from the media query rather than from a coincidence in the type
  // scale. If the rule ever stops applying, the phone quietly drops to this
  // number too and the check above starts failing instead of both passing.
  const laptopSize = await page
    .locator("input[type='email']")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  ok(
    "a laptop keeps the design size, not the phone one",
    laptopSize > 0 && laptopSize < NO_ZOOM,
    `${laptopSize}px`
  );

  // Centred once there's room for a card, rather than pinned to the bottom.
  const view = page.viewportSize();
  const button = await page.locator("button[type='submit']").boundingBox();
  const centre = (button.y + button.height / 2) / view.height;
  ok(
    "the card is centred on a laptop",
    centre > 0.4 && centre < 0.72,
    `centre at ${Math.round(centre * 100)}% down the screen`
  );

  await page.click("text=Create an account");
  const title = await page.locator("h1").innerText();
  ok("you can switch to creating an account", title === "Create your account", title);

  await page.click("text=Email me a sign-in link instead");
  const noPassword = await page.locator("input[type='password']").count();
  ok("the link mode drops the password box", noPassword === 0, `${noPassword} password fields`);

  // Back to the pitch, and then a reload still remembers you've seen it.
  await page.click("text=Back");
  const returned = await landingUp(page)
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  ok("Back returns to the landing page", returned);

  await context.close();
}

/* --------------------------------- report --------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};

console.log(`\n${c.bold("Polstar · the front door")}  ${c.dim("phone, laptop, and keyboard up")}\n`);
console.log(c.dim("  palette         worst on the landing page     worst on the sign-in card"));
for (const [theme, landing, card] of contrastTable) {
  const left = `${landing.key} ${landing.value}:1`;
  console.log(`  ${theme.padEnd(16)}${left.padEnd(30)}${card.key} ${card.value}:1`);
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
