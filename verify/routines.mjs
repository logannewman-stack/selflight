// Routines: the form, the sentence it reads back, and what it posts.
//
//   npm run dev
//   node verify/routines.mjs
//
// Routines are account-only, so most of this runs against a dev server with a
// Supabase project configured and a stand-in for its API:
//
//   VITE_SUPABASE_URL=https://fake123.supabase.co \
//   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyZWYiOiJmYWtlMTIzIn0.x \
//     npx vite --port 5174
//   SELFLIGHT_ACCOUNT_URL=http://localhost:5174/ node verify/routines.mjs
//
// Without it the signed-in half is skipped and says so, rather than reporting a
// pass it never ran.

import { chromium } from "playwright";

const SIGNED_OUT_URL = process.env.SELFLIGHT_URL || "http://localhost:5173/";
const ACCOUNT_URL = process.env.SELFLIGHT_ACCOUNT_URL || "";
const REF = "fake123";
const UID = "11111111-2222-3333-4444-555555555555";

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

/* -------------------------------- signed out ------------------------------ */

{
  const page = await browser.newPage({ viewport: { width: 1300, height: 940 } });
  await page.route("**/api/capabilities", CAPABILITIES);
  await page.goto(SIGNED_OUT_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");

  await page.click("nav button:has-text('Routines')");
  await page.waitForTimeout(400);

  const text = await page.locator("aside").innerText();
  // Saying "you need an account" beats a page of controls that fail on save.
  ok("signed out, Routines explains itself instead of failing later", /account/i.test(text), text.slice(0, 90));
  ok("and doesn't offer a form that can't work", (await page.getByText("New routine").count()) === 0);
  await page.close();
}

/* -------------------------------- signed in ------------------------------- */

if (!ACCOUNT_URL) {
  skipped.push("the signed-in half — set SELFLIGHT_ACCOUNT_URL to a dev server with Supabase configured");
} else {
  // The fake account's routines, and every request the browser made.
  const stored = [];
  const posted = [];

  const context = await browser.newContext({ viewport: { width: 1300, height: 940 } });
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.route("**/api/capabilities", CAPABILITIES);
  await page.route(`**${REF}.supabase.co/**`, (route) => {
    const url = route.request().url();
    const json = (body) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(body)
      });
    if (route.request().method() === "OPTIONS") {
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
    if (url.includes("/rest/v1/user_settings")) return json([{ settings: {} }]);
    return json([]);
  });

  // Stand in for the routines endpoint, which needs a real database behind it.
  await page.route("**/api/routines**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (request.method() === "GET") {
      return json({
        routines: stored,
        runs: stored.flatMap((r) => r.runs || [])
      });
    }
    if (request.method() === "POST" && url.searchParams.get("action") === "run") {
      const found = stored.find((r) => r.id === url.searchParams.get("id"));
      if (found) {
        found.runs = [
          { id: "run1", routineId: found.id, status: "ok", summary: "Three things happened.", at: new Date().toISOString() }
        ];
      }
      return json({ status: "ok", summary: "Three things happened." });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      posted.push(body);
      stored.push({
        ...body,
        id: `r${stored.length + 1}`,
        nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
        runs: []
      });
      return json({ routine: stored.at(-1) });
    }
    if (request.method() === "PATCH") {
      const body = request.postDataJSON();
      posted.push(body);
      const found = stored.find((r) => r.id === url.searchParams.get("id"));
      if (found) Object.assign(found, body);
      return json({ routine: found });
    }
    if (request.method() === "DELETE") {
      const at = stored.findIndex((r) => r.id === url.searchParams.get("id"));
      if (at >= 0) stored.splice(at, 1);
      return json({ ok: true });
    }
    return json({});
  });

  await page.goto(ACCOUNT_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea");
  await page.waitForTimeout(2200);

  await page.click("nav button:has-text('Routines')");
  await page.waitForTimeout(600);

  ok("signed in, Routines offers a form", (await page.getByText("New routine").count()) > 0);

  await page.click("button:has-text('New routine')");
  await page.waitForTimeout(400);

  await page.fill("input[aria-label='Routine name']", "Morning briefing");
  await page.fill("textarea[aria-label='What to ask']", "What changed in AI overnight? Three bullets.");
  await page.selectOption("select[aria-label='How often']", "week");
  await page.waitForTimeout(200);
  await page.selectOption("select[aria-label='Which day']", "2");
  await page.fill("input[aria-label='Time']", "09:00");
  await page.waitForTimeout(400);

  // The sentence is what makes this readable rather than a row of database
  // fields, so it's worth checking it actually says what was chosen.
  const sentence = await page.locator("aside p.bg-panel, aside .bg-panel").first().innerText();
  ok("the form reads itself back as a sentence", /Every Tuesday at 09:00/.test(sentence), sentence.slice(0, 120));
  ok("and quotes what it will ask", /AI overnight/.test(sentence), sentence.slice(0, 160));
  ok("and says where the answer goes", /new chat/i.test(sentence), sentence.slice(0, 200));

  await page.click("button:has-text('Create routine')");
  await page.waitForTimeout(800);

  const made = posted.at(-1);
  ok("creating posts the schedule the form showed", made?.every === "week" && made?.weekday === 2, JSON.stringify(made));
  ok("with the time in minutes past midnight", made?.atMinute === 540, String(made?.atMinute));
  ok("and a real time zone", Boolean(made?.zone) && made.zone.length > 2, made?.zone);
  ok("and somewhere for the answer to go", Array.isArray(made?.deliver) && made.deliver.includes("chat"));

  // `exact`, because the panel's own intro says "A morning briefing, a Monday
  // summary…" — a substring match passed whether or not the row existed.
  ok(
    "the routine appears in the list",
    (await page.getByText("Morning briefing", { exact: true }).count()) > 0
  );
  const row = await page.locator("aside").innerText();
  ok("and the list shows when it next runs", /next /.test(row), row.slice(0, 200));

  /* ------------------------------ running it ----------------------------- */

  await page.click("button[aria-label='Run now']");
  await page.waitForTimeout(900);
  ok(
    "Run now shows what came back",
    (await page.locator("aside").innerText()).includes("Three things happened.")
  );

  /* ------------------------------- pausing ------------------------------- */

  await page.click("button[aria-label='Pause']");
  await page.waitForTimeout(700);
  ok("pausing says so", (await page.getByText("Paused").count()) > 0);
  ok(
    "and only sends the change, not the whole routine",
    Object.keys(posted.at(-1) || {}).join() === "enabled",
    JSON.stringify(posted.at(-1))
  );

  /* ------------------------------- deleting ------------------------------ */

  await page.click("button[aria-label='Delete']");
  await page.waitForTimeout(300);
  await page.click("button:has-text('Delete')");
  await page.waitForTimeout(900);

  ok(
    "deleting removes it from the list",
    (await page.getByText("Morning briefing", { exact: true }).count()) === 0
  );
  ok("and from the account", stored.length === 0, JSON.stringify(stored.map((r) => r.id)));

  for (const message of errors) ok(`no page errors`, false, message);
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

console.log(`\n${c.bold("Selflight · routines")}\n`);
for (const { label, pass, detail } of checks) {
  console.log(`  ${pass ? c.green("✓") : c.red("✗")} ${label}${detail && !pass ? c.dim(`  — ${detail}`) : ""}`);
}
for (const note of skipped) console.log(`  ${c.yellow("–")} skipped: ${note}`);

const failed = checks.filter((k) => !k.pass).length;
console.log(
  `\n  ${failed ? c.red(`${failed} failed`) : c.green(`all ${checks.length} passed`)}` +
    `${skipped.length ? c.yellow(`, ${skipped.length} skipped`) : ""}\n`
);

await browser.close();
process.exit(failed ? 1 : 0);
