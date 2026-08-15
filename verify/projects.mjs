// Projects, and whether a project's instructions actually reach the model.
//
//   npm run dev
//   node verify/projects.mjs
//
// The check that decides this feature is the one on the request body. A project
// with instructions saved and a chat inside it looks identical whether or not
// those instructions were sent — right up until the answer ignores every one of
// them, and the person concludes the feature doesn't work rather than that it
// silently dropped their text.

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

const page = await browser.newPage({ viewport: { width: 1300, height: 940 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.route("**/api/capabilities", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ provider: "Perplexity", configured: true, connectors: false })
  })
);

const sent = [];
await page.route("**/api/chat", (route) => {
  const body = route.request().postDataJSON();
  if (body?.task === "title") {
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"title":null}' });
  }
  sent.push(body);
  return route.fulfill({
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
    body: `data: ${JSON.stringify({ text: "Noted." })}\n\ndata: {"done":true}\n\n`
  });
});

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForSelector("textarea");

const INSTRUCTIONS =
  "We are shipping the Q3 launch. Always answer in British English and never use bullet points.";

/* ------------------------------ making one ------------------------------- */

// The panel remembers which project was open, so getting back to the list
// means using the back link when it's there.
async function openProjects() {
  await page.click("nav button:has-text('Projects')");
  await page.waitForTimeout(400);
  const back = page.locator("button:has-text('All projects')");
  if (await back.count()) {
    await back.click();
    await page.waitForTimeout(300);
  }
}

async function openProject(name) {
  await openProjects();
  await page.locator(`button:has-text('${name}')`).first().click();
  await page.waitForTimeout(400);
}

await openProjects();
ok("Projects has a place in the sidebar", (await page.getByText("A project keeps its own").count()) > 0);

await page.fill("input[aria-label='New project name']", "Q3 launch");
await page.click("button:has-text('Create')");
await page.waitForTimeout(500);

ok(
  "creating a project opens it",
  (await page.locator("input[aria-label='Project name']").inputValue()) === "Q3 launch"
);

await page.fill("#project-instructions", INSTRUCTIONS);
// Longer than the 600ms save debounce.
await page.waitForTimeout(1100);
ok("the instructions box says it saved", (await page.getByText("Saved").count()) > 0);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("textarea");
await openProject("Q3 launch");
ok(
  "the instructions survive a reload",
  (await page.locator("#project-instructions").inputValue()) === INSTRUCTIONS
);

/* --------------------- do the instructions reach the model? --------------- */

await page.click("button:has-text('New chat in this project')");
await page.waitForTimeout(400);
await page.fill("textarea", "How should I word the announcement?");
await page.press("textarea", "Enter");
await page.waitForTimeout(1200);

const posted = sent.at(-1);
ok(
  "a chat in a project sends the project's instructions",
  JSON.stringify(posted?.project || {}).includes("British English"),
  JSON.stringify(posted?.project || null)?.slice(0, 120)
);
ok("and names the project", posted?.project?.name === "Q3 launch", posted?.project?.name);
ok("and sends its id, which is what a signed-in request uses", Boolean(posted?.projectId));

/* -------------------- and stay with the chat afterwards ------------------- */

await page.click("text=New chat");
await page.waitForTimeout(300);
await page.fill("textarea", "Unrelated question");
await page.press("textarea", "Enter");
await page.waitForTimeout(1200);

ok(
  "a chat started outside the project doesn't get its instructions",
  !sent.at(-1)?.project,
  JSON.stringify(sent.at(-1)?.project || null)
);

// Reopening the project's chat has to put the project back, or a follow-up
// message in it would silently lose the context the first message had.
await page.locator("nav[aria-label='Conversations'] button:has-text('How should I word')").first().click();
await page.waitForTimeout(600);
await page.fill("textarea", "And the subject line?");
await page.press("textarea", "Enter");
await page.waitForTimeout(1200);

ok(
  "reopening a project's chat keeps its instructions on the next message",
  JSON.stringify(sent.at(-1)?.project || {}).includes("British English"),
  JSON.stringify(sent.at(-1)?.project || null)?.slice(0, 100)
);

/* --------------------------- deleting keeps chats ------------------------- */

const before = await page.locator("nav[aria-label='Conversations'] button[aria-label^='Pin ']").count();

await openProject("Q3 launch");
await page.click("button:has-text('Delete project')");
await page.waitForTimeout(300);

const warning = await page.locator("text=/will stay/").count();
ok("deleting says the conversations survive", warning > 0);

await page.click("button:has-text('Delete')");
await page.waitForTimeout(600);

const after = await page.locator("nav[aria-label='Conversations'] button[aria-label^='Pin ']").count();
ok("and they really do", after === before, `${before} chats before, ${after} after`);
ok("the project itself is gone", (await page.getByText("Q3 launch").count()) === 0);

/* --------------------------------- report -------------------------------- */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};

console.log(`\n${c.bold("Polstar · projects")}\n`);
for (const { label, pass, detail } of checks) {
  console.log(`  ${pass ? c.green("✓") : c.red("✗")} ${label}${detail && !pass ? c.dim(`  — ${detail}`) : ""}`);
}
for (const message of errors) console.log(c.red(`\n  page error: ${message}`));

const failed = checks.filter((k) => !k.pass).length + errors.length;
console.log(`\n  ${failed ? c.red(`${failed} failed`) : c.green(`all ${checks.length} passed`)}\n`);

await browser.close();
process.exit(failed ? 1 : 0);
