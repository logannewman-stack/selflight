// Asks the configured model the awkward questions and scores what comes back.
//
//   npm run eval              # every probe
//   npm run eval -- --group fabrication
//   npm run eval -- --show    # print the replies too
//
// Ten short questions on the cheapest tier: a few cents a run. Worth it before
// a prompt change ships, because "the wording seemed better" is not evidence
// and this is.
//
// It sends the real BASE_PROMPT through the real provider, so what's measured
// is what people get. The graders live in probes.js and are themselves tested
// in probes.test.mjs — a grader that always passes would turn this whole file
// into a green tick that means nothing.

import fs from "node:fs";
import path from "node:path";
import { BASE_PROMPT } from "../api/prompt.js";
import { PROBES, GROUPS, score } from "./probes.js";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const only = args.includes("--group") ? args[args.indexOf("--group") + 1] : null;
const show = args.includes("--show");

/* ------------------------------ environment ------------------------------ */

function readEnvFile(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return {};

  const found = {};
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2].trim();
    const quoted = /^(["'])(.*)\1$/.exec(value);
    found[match[1]] = quoted ? quoted[2] : value;
  }
  return found;
}

const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const env = (key) => process.env[key] || fileEnv[key] || "";

/* -------------------------------- asking --------------------------------- */

// The cheapest tier on purpose. Honesty shouldn't need the expensive model —
// if it only holds on the deep one, that's a finding, not a reason to test on it.
async function askPerplexity(question) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("PERPLEXITY_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: BASE_PROMPT },
        { role: "user", content: question }
      ],
      max_tokens: 700
    })
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  // Reasoning models narrate first; the answer is what's left.
  return String(body.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function askClaude(question) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env("ANTHROPIC_MODEL") || "claude-sonnet-5",
      max_tokens: 700,
      system: BASE_PROMPT,
      messages: [{ role: "user", content: question }]
    })
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return (body.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

const ask = env("PERPLEXITY_API_KEY")
  ? { name: "Perplexity · sonar", call: askPerplexity }
  : env("ANTHROPIC_API_KEY")
    ? { name: "Claude", call: askClaude }
    : null;

if (!ask) {
  console.error(
    "\nNo model key. Set PERPLEXITY_API_KEY or ANTHROPIC_API_KEY in .env.local and try again.\n"
  );
  process.exit(2);
}

/* --------------------------------- running -------------------------------- */

const chosen = only ? PROBES.filter((p) => p.group === only) : PROBES;

if (!chosen.length) {
  console.error(`\nNo probes in group "${only}". Groups: ${GROUPS.join(", ")}\n`);
  process.exit(2);
}

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`
};

console.log(`\n${c.bold("Selflight · honesty")}  ${c.dim(ask.name)}\n`);

const replies = {};
// One at a time rather than in parallel: rate limits produce failures that look
// like honesty failures, which would be a miserable thing to debug.
for (const probe of chosen) {
  try {
    replies[probe.id] = await ask.call(probe.ask);
  } catch (err) {
    console.log(`  ${c.red("!")} ${probe.id} ${c.dim(`— couldn't ask: ${err.message}`)}`);
  }
}

const { results, passed, total } = score(replies);
const shown = results.filter((r) => chosen.some((p) => p.id === r.id));

let group = null;
for (const result of shown) {
  if (result.group !== group) {
    group = result.group;
    console.log(`  ${c.dim(group)}`);
  }
  console.log(`    ${result.pass ? c.green("✓") : c.red("✗")} ${result.id} ${c.dim(`— ${result.note}`)}`);
  if (!result.pass) console.log(`        ${c.dim(result.why)}`);
  if (show && replies[result.id]) {
    console.log(c.dim(`        ${replies[result.id].replace(/\n/g, "\n        ").slice(0, 600)}`));
  }
}

const scored = shown.length;
const won = shown.filter((r) => r.pass).length;

console.log(`\n  ${won === scored ? c.green(`${won}/${scored}`) : c.red(`${won}/${scored}`)} ${c.dim("· run with --show to read the replies")}\n`);

// Non-zero on any failure, so this can gate a deploy rather than only inform one.
process.exit(won === scored ? 0 : 1);
