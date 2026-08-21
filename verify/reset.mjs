// Does the password reset actually reset the password?
//
//   node verify/reset.mjs                      # against the dev server
//   SELFLIGHT_URL=https://polstar.ai/ node verify/reset.mjs
//
// The obvious way to test this is to click a link in your inbox, which is slow,
// can't be automated, and — worse — proves less than it looks like it does. A
// recovery link signs you in. So "I clicked it and ended up in the app" is what
// success and total failure both look like. The password is the only thing that
// settles it, and you can't see a password.
//
// So this doesn't use a mailbox. Supabase's admin API will mint a real recovery
// link without sending anything (`admin/generate_link`), which means the whole
// round trip can run in a browser in about fifteen seconds:
//
//   make a throwaway account with a known password
//   mint a real recovery link for it
//   follow the link in a real browser, exactly as a person would
//   set a new password on the screen that appears
//   ask the auth server to sign in with the new one   — must work
//   ask it to sign in with the old one                — must not
//   use the link a second time                        — must be refused
//   delete the account
//
// The two sign-in attempts at the end are the point. Everything above them can
// pass while the password is untouched, and that failure is invisible from the
// screen: the app looks delighted, and the person finds out weeks later when
// they're signed out.
//
// What this does NOT cover, and can't: whether the email arrives. That's SMTP,
// not code, and it's the likeliest thing to be wrong — see the last check,
// which asks the auth server to send one and reports what it says.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const SITE = process.env.SELFLIGHT_URL || "http://localhost:5173/";

/* ------------------------------ credentials ------------------------------- */

function readEnvFile(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return {};

  const found = {};
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    found[match[1]] = quoted ? quoted[2] : value;
  }
  return found;
}

const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const env = (...keys) => keys.map((k) => process.env[k] || fileEnv[k]).find(Boolean) || "";

const URL_ = env("SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/$/, "");
const ANON = env("VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");

// Refusing beats running: a harness that skips what it can't reach and then
// prints a tidy summary is a harness that reports success for doing nothing.
const missing = [
  !URL_ && "VITE_SUPABASE_URL",
  !ANON && "VITE_SUPABASE_ANON_KEY",
  !SERVICE && "SUPABASE_SERVICE_ROLE_KEY"
].filter(Boolean);

if (missing.length) {
  console.error(
    `\n  Can't check the reset flow without ${missing.join(", ")}.\n\n` +
      "  The first two are in Vercel already. The service-role key is the one under\n" +
      "  Supabase → Settings → API that must never reach a browser — this reads it\n" +
      "  from .env.local and never sends it anywhere but your own project.\n"
  );
  process.exit(2);
}

// A throwaway account, named so it's obvious what it is if cleanup ever fails.
// `example.com` is reserved by the IETF precisely so it can't be anybody's.
const ACCOUNT = `polstar-reset-check-${crypto.randomUUID().slice(0, 8)}@example.com`;
const OLD = "old-password-9f2c1a";
const NEW = "new-password-4b7e30";

/* -------------------------------- the API --------------------------------- */

const admin = (route, init = {}) =>
  fetch(`${URL_}/auth/v1${route}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });

const anon = (route, init = {}) =>
  fetch(`${URL_}/auth/v1${route}`, {
    ...init,
    headers: { apikey: ANON, "Content-Type": "application/json", ...init.headers }
  });

const body = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
};

const said = (payload) =>
  payload?.msg || payload?.message || payload?.error_description || payload?.error || payload?.raw || "";

/* -------------------------------- reporting ------------------------------- */

const checks = [];
const ok = (label, pass, detail = "") => checks.push({ label, pass: Boolean(pass), detail });

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  amber: (s) => `\x1b[33m${s}\x1b[0m`
};

const notes = [];

/* --------------------------------- the run -------------------------------- */

let userId = null;
let browser = null;

try {
  /* ---- an account to lose the password to ---- */

  const made = await admin("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email: ACCOUNT, password: OLD, email_confirm: true })
  });
  const account = await body(made);

  if (!made.ok || !account.id) {
    console.error(
      `\n  Couldn't create a test account (HTTP ${made.status}): ${said(account)}\n\n` +
        "  A 401 here means the service-role key is wrong or is the anon key.\n"
    );
    process.exit(2);
  }
  userId = account.id;

  /* ---- a real recovery link, without an email ---- */

  const minted = await admin("/admin/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "recovery", email: ACCOUNT, options: { redirect_to: SITE } })
  });
  const link = await body(minted);
  // The shape moved between GoTrue versions; accept either.
  const action = link.action_link || link.properties?.action_link || "";

  ok("the auth server will mint a recovery link", Boolean(action), said(link));
  if (!action) throw new Error("no link to follow");

  /* ---- follow it, exactly as a person would ---- */

  browser = await chromium.launch({
    args: ["--no-sandbox"],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  });
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // The app asks what the backend can do before it renders. On a dev server
  // there's no serverless function answering, and an unanswered request is a
  // spinner rather than a screen.
  await page.route("**/api/capabilities", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ provider: "Anthropic", configured: true, connectors: false })
    })
  );

  await page.goto(action, { waitUntil: "domcontentloaded" });

  // Where it landed decides one thing on its own: whether SITE is in the
  // project's redirect allow-list. GoTrue doesn't error on a disallowed
  // redirect — it quietly sends you to the Site URL instead, which is why this
  // is checked by looking rather than by asking.
  const landed = new URL(page.url());
  const wanted = new URL(SITE);
  ok(
    "the link comes back to this site rather than somewhere else",
    landed.origin === wanted.origin,
    landed.origin === wanted.origin
      ? landed.origin
      : `landed on ${landed.origin} — add ${wanted.origin}/** to Supabase → Authentication → URL Configuration → Redirect URLs`
  );

  const arrived = await page
    .locator("h1", { hasText: "Set a new password" })
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  ok("it opens the set-a-password screen, not the chat", arrived);

  if (arrived) {
    await page.fill("input[type='password']", NEW);
    await page.click("button[type='submit']");

    const moved = await page
      .locator("h1", { hasText: "Set a new password" })
      .waitFor({ state: "detached", timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    const complaint = await page
      .locator("[role='alert']")
      .first()
      .innerText()
      .catch(() => "");
    ok("saving it moves on rather than sitting there", moved, complaint);
  }

  /* ---- the only two questions that settle it ---- */

  const signIn = (password) =>
    anon("/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email: ACCOUNT, password })
    });

  const withNew = await signIn(NEW);
  ok(
    "the new password now signs in",
    withNew.ok,
    withNew.ok ? "" : `HTTP ${withNew.status}: ${said(await body(withNew))}`
  );

  const withOld = await signIn(OLD);
  ok(
    "and the old one no longer does",
    !withOld.ok,
    withOld.ok
      ? "the old password still works — the screen said yes and changed nothing"
      : `refused with HTTP ${withOld.status}`
  );

  /* ---- and it's single use ---- */

  await page.goto(action, { waitUntil: "domcontentloaded" });
  await page.locator("h1").waitFor({ timeout: 10000 }).catch(() => {});
  const second = await page.locator("h1").innerText().catch(() => "");
  const explained = await page
    .locator("[role='alert']")
    .first()
    .innerText()
    .catch(() => "");

  ok(
    "using the link twice is refused, and says why",
    second === "Reset your password" && /expired|already been used/i.test(explained),
    `${second || "no heading"} — ${explained || "nothing on screen"}`
  );

  ok("nothing threw in the browser", pageErrors.length === 0, pageErrors.join(" · "));

  /* ---- the part this can't prove: does the email arrive? ---- */

  // Everything above deliberately skipped the mail server. This is the one call
  // that doesn't. It can't check an inbox, but it can hear the auth server
  // refuse — which is what a broken SMTP config and an exhausted rate limit
  // both sound like, and either one silently breaks this for real people while
  // every check above stays green.
  const posted = await anon(`/recover?redirect_to=${encodeURIComponent(SITE)}`, {
    method: "POST",
    body: JSON.stringify({ email: ACCOUNT })
  });
  const reply = said(await body(posted));

  ok(
    "the auth server accepts a request to send one",
    posted.ok,
    posted.ok ? "" : `HTTP ${posted.status}: ${reply}`
  );

  if (!posted.ok && /rate limit/i.test(reply)) {
    notes.push(
      "Rate limited. Supabase's built-in mail server allows a handful of messages an\n" +
        "  hour and is documented as unsuitable for production — set up custom SMTP\n" +
        "  under Authentication → Emails before anybody but you relies on this."
    );
  } else if (!posted.ok) {
    notes.push(
      "The auth server wouldn't send the email. Everything above still passed, which\n" +
        "  is the shape of this failure: the code is fine and the mail isn't, so nobody\n" +
        "  can start the flow that all of it verifies."
    );
  } else {
    notes.push(
      "Accepted for delivery — which is not the same as delivered. The only way to\n" +
        "  know is to reset your own password once and watch for it, spam folder\n" +
        "  included. If Supabase's built-in mail server is still in use, expect a few\n" +
        "  an hour at best; custom SMTP is the fix."
    );
  }

  await context.close();
} catch (err) {
  // Caught rather than thrown so the report below still prints. A stack trace
  // where a list of checks should be is how you end up unsure whether the run
  // failed or never started.
  ok("the run got all the way through", false, err.message);
} finally {
  // In a finally because a half-failed run must not leave an account behind in
  // the auth table of a live project.
  if (browser) await browser.close();
  if (userId) {
    const gone = await admin(`/admin/users/${userId}`, { method: "DELETE" });
    ok(
      "the test account is cleaned up after itself",
      gone.ok,
      gone.ok ? ACCOUNT : `HTTP ${gone.status} — delete ${ACCOUNT} by hand`
    );
  }
}

/* --------------------------------- report --------------------------------- */

console.log(
  `\n${c.bold("Polstar · forgetting a password")}  ${c.dim(`${new URL(SITE).origin}, no mailbox involved`)}\n`
);
for (const { label, pass, detail } of checks) {
  console.log(`  ${pass ? c.green("✓") : c.red("✗")} ${label}${detail ? c.dim(`  — ${detail}`) : ""}`);
}
for (const note of notes) console.log(`\n  ${c.amber("·")} ${note}`);

const failed = checks.filter((k) => !k.pass).length;
console.log(`\n  ${failed ? c.red(`${failed} failed`) : c.green(`all ${checks.length} passed`)}\n`);

process.exit(failed ? 1 : 0);
