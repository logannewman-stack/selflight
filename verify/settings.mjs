// Do appearance changes actually take effect, and actually stick?
//
//   npm run dev
//   node verify/settings.mjs
//
// Two halves. The first drives a signed-out browser holding settings from
// before High contrast became the default. The second stands up a fake Supabase
// project and drives the signed-in path — where settings live in Postgres, not
// in the browser, and which nothing had ever tested.
//
// That gap is the point of this file. Everything else about appearance was
// verified signed out, which is not how anyone with an account uses it: their
// settings row is the copy that decides what they see, and clearing the browser
// wouldn't touch it.
//
// For the signed-in half, run a second dev server with a project configured and
// point this at it:
//
//   VITE_SUPABASE_URL=https://fake123.supabase.co \
//   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyZWYiOiJmYWtlMTIzIn0.x \
//     npx vite --port 5174
//   SELFLIGHT_ACCOUNT_URL=http://localhost:5174/ node verify/settings.mjs
//
// Without it the signed-in half is skipped, and says so rather than reporting a
// pass it never ran.

import { chromium } from "playwright";

const URL = process.env.SELFLIGHT_URL || "http://localhost:5173/";
const ACCOUNT_URL = process.env.SELFLIGHT_ACCOUNT_URL || "";
const REF = "fake123";
const UID = "11111111-2222-3333-4444-555555555555";

const CONTRAST = "255 255 255";
const PAPER = "252 251 249";
const NOCTURNE = "10 10 11";

// A settings blob exactly as it was written before the default changed.
const BEFORE = {
  theme: "paper",
  matchSystem: false,
  lightTheme: "paper",
  darkTheme: "midnight",
  accent: "palette",
  accentCustom: "",
  baseColor: "",
  textSize: "lg",
  tone: "direct"
};

const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  ...(process.env.HTTPS_PROXY
    ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } }
    : {})
});

const checks = [];
const ok = (label, pass, detail = "") => checks.push({ label, pass: Boolean(pass), detail });
const skipped = [];

const CAPABILITIES = (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ provider: "Perplexity", configured: true, connectors: false })
  });

const READ = () => ({
  page: getComputedStyle(document.documentElement).getPropertyValue("--page").trim(),
  stored: JSON.parse(localStorage.getItem("selflight.settings.v1") || "null")
});

/* ------------------------------- signed out ------------------------------- */

// Seeded through addInitScript so the blob is in place before any app code
// runs. Setting it after load and reloading raced the app's own save, which
// clobbered the blob with defaults — and made the migration look like it had
// worked when what had actually happened was a fresh start.
async function bootWith(blob) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await context.addInitScript((s) => {
    localStorage.setItem("selflight.settings.v1", JSON.stringify(s));
  }, blob);

  const page = await context.newPage();
  await page.route("**/api/capabilities", CAPABILITIES);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(500);

  const found = await page.evaluate(READ);
  await context.close();
  return found;
}

let seen = await bootWith(BEFORE);
ok(
  "a browser holding the old default opens in High contrast",
  seen.page === CONTRAST,
  `page ${seen.page}`
);
ok(
  "and keeps everything that isn't a colour",
  seen.stored?.textSize === "lg" && seen.stored?.tone === "direct",
  `textSize ${seen.stored?.textSize}, tone ${seen.stored?.tone}`
);

seen = await bootWith({ ...BEFORE, theme: "nocturne" });
ok("a palette somebody chose is left alone", seen.page === NOCTURNE, `page ${seen.page}`);

seen = await bootWith({ ...BEFORE, baseColor: "#3B6EA5" });
ok(
  "a main colour somebody set is left alone",
  seen.page === "59 110 165" && seen.stored?.theme === "paper",
  `page ${seen.page}, theme ${seen.stored?.theme}`
);

seen = await bootWith({ ...BEFORE, accent: "teal" });
ok("an accent somebody picked is left alone", seen.page === PAPER, `page ${seen.page}`);

// The migration must not reapply, or Paper becomes a palette you cannot choose.
seen = await bootWith({ ...BEFORE, theme: "paper", v: 2 });
ok("going back to Paper afterwards sticks", seen.page === PAPER, `page ${seen.page}`);

/* -------------------------------- signed in ------------------------------- */

if (!ACCOUNT_URL) {
  skipped.push(
    "the signed-in half — set SELFLIGHT_ACCOUNT_URL to a dev server with a Supabase project configured"
  );
} else {
  // The fake project's settings row, which stands in for Postgres.
  let row = { ...BEFORE };
  const writes = [];

  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await context.addInitScript(
    ([ref, uid]) => {
      localStorage.setItem(
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: "tok",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "ref",
          user: {
            id: uid,
            email: "you@example.com",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: {},
            user_metadata: {}
          }
        })
      );
    },
    [REF, UID]
  );

  const page = await context.newPage();
  await page.route("**/api/capabilities", CAPABILITIES);
  await page.route(`**${REF}.supabase.co/**`, async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(body)
      });

    if (method === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*"
        }
      });
    }
    if (url.includes("/auth/v1/user")) {
      return json({ id: UID, email: "you@example.com", aud: "authenticated", role: "authenticated" });
    }
    if (url.includes("/auth/v1/")) {
      return json({
        access_token: "tok",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "ref",
        user: { id: UID, email: "you@example.com" }
      });
    }
    if (url.includes("/rest/v1/user_settings")) {
      if (method === "GET") return json([{ settings: row }]);
      const body = request.postDataJSON();
      const next = Array.isArray(body) ? body[0] : body;
      if (next?.settings) {
        writes.push(next.settings);
        row = next.settings;
      }
      return json([{ settings: row }]);
    }
    if (url.includes("/rest/v1/")) return json([]);
    return json({});
  });

  const paint = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--page").trim()
    );

  await page.goto(ACCOUNT_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2600);

  ok("an account is recognised", (await page.locator("textarea").count()) > 0);
  ok(
    "an account row holding the old default opens in High contrast",
    (await paint()) === CONTRAST,
    `page ${await paint()}`
  );
  ok(
    "and the account keeps everything that isn't a colour",
    row.textSize === "lg" && row.tone === "direct",
    `textSize ${row.textSize}, tone ${row.tone}`
  );
  ok("the migration is written back, so it runs once", row.v === 2, `v ${row.v}`);

  // Now change a setting the way a person would, and check it reaches the
  // database rather than only the screen.
  const before = writes.length;
  await page.click("button[aria-label='Settings']");
  await page.waitForTimeout(400);
  await page.click("button:has-text('Appearance')");
  await page.waitForTimeout(500);
  await page.click("button:has-text('Nocturne')");
  await page.waitForTimeout(1600);

  ok("choosing a palette repaints straight away", (await paint()) === NOCTURNE, `page ${await paint()}`);
  ok("and is written to the account", row.theme === "nocturne", `row says ${row.theme}`);
  ok("without writing on every frame", writes.length - before <= 3, `${writes.length - before} writes`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2600);
  ok("and survives a reload", (await paint()) === NOCTURNE, `page ${await paint()}`);

  // A change made in the last moment before the tab goes away. The debounce is
  // 700ms; this hides the page after 150ms, well inside it.
  await page.click("button[aria-label='Settings']");
  await page.waitForTimeout(400);
  await page.click("button:has-text('Appearance')");
  await page.waitForTimeout(500);
  const wrote = writes.length;
  await page.click("button:has-text('Midnight')");
  await page.waitForTimeout(150);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  // Deliberately less than the remaining debounce: 150 + 250 is under 700, so
  // the only thing that can have written by now is the flush. Waiting longer
  // let the ordinary timer fire and the check passed either way.
  await page.waitForTimeout(250);

  ok(
    "a change made just before the tab closes is still saved",
    writes.length > wrote && row.theme === "midnight",
    `row says ${row.theme}`
  );

  await context.close();
}

/* --------------------------------- report -------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`
};

console.log(`\n${c.bold("Selflight · settings take effect and stick")}\n`);
for (const { label, pass, detail } of checks) {
  console.log(`  ${pass ? c.green("✓") : c.red("✗")} ${label}${detail ? c.dim(`  — ${detail}`) : ""}`);
}
for (const note of skipped) console.log(`  ${c.yellow("–")} skipped: ${note}`);

const failed = checks.filter((k) => !k.pass).length;
console.log(
  `\n  ${failed ? c.red(`${failed} failed`) : c.green(`all ${checks.length} passed`)}` +
    `${skipped.length ? c.yellow(`, ${skipped.length} skipped`) : ""}\n`
);

await browser.close();
process.exit(failed ? 1 : 0);
