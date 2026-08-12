import Anthropic from "@anthropic-ai/sdk";

// Searches and multi-step tool use can run well past a default timeout.
export const config = { maxDuration: 120 };

const MODEL = "claude-opus-5";
const MAX_TOKENS = 64000;

// Turns kept in the prompt. Older turns drop off so long chats stay affordable.
const CONTEXT_WINDOW = 40;

// Server-side tools pause after a batch of work and expect to be resumed.
const MAX_CONTINUATIONS = 6;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MCP_BETA = "mcp-client-2025-11-20";

const BASE_PROMPT = `You are Selflight, a general-purpose AI assistant.

Voice:
- Direct and warm. Lead with the useful thing, then the reasoning behind it.
- Plain language. No filler, no throat-clearing, no restating the question back.
- Say "I'm not sure" plainly instead of hedging through a whole paragraph.
- Never open by praising the question or the person.

Substance:
- Answer what was actually asked. If the better question is a different one, answer that too and say why.
- When asked to choose, give one recommendation and the tradeoff you accepted, not a survey.
- Prefer concrete numbers, examples, and specifics over abstractions.
- If the plan is a bad idea, say so early and offer the better path.
- For medical, legal, or financial questions with real stakes, give what you know and point to a professional.

Tools:
- When the answer depends on something current — recent events, prices, versions, anything time-sensitive — search before answering instead of answering from memory.
- Link the sources you used inline, so the person can check them.
- Use a connected tool when it is the right way to get the answer; say plainly when a tool fails rather than guessing at what it would have returned.

Format:
- Prose by default, in short paragraphs.
- Lists only when the content is genuinely a list.
- Code in fenced blocks with a language tag. Give complete, runnable code rather than fragments with gaps.
- Headers only when the answer is long enough to need them.`;

const TONES = {
  balanced: "",
  warm: "Tone: warm and encouraging. Acknowledge how something lands before moving to the answer, without becoming sentimental.",
  direct: "Tone: blunt and efficient. Skip pleasantries entirely. Shortest correct answer wins.",
  playful: "Tone: relaxed and a little witty. Keep the humour light and never at the cost of the answer."
};

const LENGTHS = {
  brief: "Length: keep answers short — a few sentences unless more was explicitly asked for.",
  adaptive: "Length: match the question. Short questions get short answers; open-ended ones get room.",
  thorough: "Length: be comprehensive. Cover edge cases, alternatives, and the reasoning behind the recommendation."
};

const DEPTHS = { quick: "low", balanced: "medium", deep: "high" };

const BUILD_PROMPT = `You build complete, self-contained web pages.

Rules:
- Reply with exactly one fenced \`\`\`html block containing a full document, starting at <!doctype html>. No prose before or after it.
- Inline all CSS and JavaScript. CDN links are fine for libraries and fonts.
- The result must run correctly on its own with no build step and no local files.
- Make it look considered: real spacing, a deliberate type scale, and a colour palette that suits the subject. Avoid default-looking output.
- Make it responsive, and keep it usable with a keyboard.
- When asked to change an existing page, return the complete updated document, not a diff.`;

const TITLE_PROMPT = `Write a title for the conversation the user shows you: 2 to 5 words, plain capitalization, no quotes, no trailing period. Reply with the title and nothing else. Do not include internal or system XML tags in your response.`;

const REFUSAL_TEXT = "I can't help with that one. Try rephrasing it, or ask me something else.";

let client;

function anthropic() {
  // Reads ANTHROPIC_API_KEY from the environment. Never sent to the browser.
  if (!client) client = new Anthropic();
  return client;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  if (!process.env.ANTHROPIC_API_KEY) {
    return json(res, 500, {
      error:
        "ANTHROPIC_API_KEY is not set. Add it to .env.local for local dev, or to your Vercel project's environment variables."
    });
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "Could not parse the request body." });
  }

  const messages = toApiMessages(body.messages);
  if (!messages.length) return json(res, 400, { error: "No messages to send." });

  if (body.task === "title") return handleTitle(res, messages);
  if (body.task === "build") return handleBuild(req, res, messages);
  return handleChat(req, res, messages, body.settings || {}, body.connectors || []);
}

/* -------------------------------- chat -------------------------------- */

async function handleChat(req, res, messages, settings, connectors) {
  const servers = toMcpServers(connectors);
  const tools = toTools(settings, servers);

  const base = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: composeSystemPrompt(settings),
    output_config: { effort: DEPTHS[settings.depth] || "medium" },
    // Caches the conversation prefix so each turn re-reads it cheaply.
    cache_control: { type: "ephemeral" }
  };

  await converse(req, res, { base, messages, tools, servers });
}

async function handleBuild(req, res, messages) {
  const base = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: BUILD_PROMPT,
    // Generated pages are worth more thinking than a chat reply.
    output_config: { effort: "high" },
    cache_control: { type: "ephemeral" }
  };

  await converse(req, res, { base, messages, tools: [], servers: [] });
}

async function converse(req, res, { base, messages, tools, servers }) {
  sseHead(res);
  const state = { emitted: false };
  let history = messages;

  try {
    for (let round = 0; round < MAX_CONTINUATIONS; round++) {
      const message = await runRound(req, res, state, { ...base, messages: history }, tools, servers);

      // Server-side tools hit their per-request iteration cap; resuming picks
      // the work back up where it stopped.
      if (message?.stop_reason === "pause_turn") {
        history = [...history, { role: "assistant", content: message.content }];
        continue;
      }

      if (message?.stop_reason === "refusal" && !state.emitted) {
        send(res, { error: REFUSAL_TEXT });
      }
      break;
    }
  } catch (err) {
    console.error(`[api/chat] ${err?.stack || err}`);
    send(res, { error: userFacingError(err), partial: state.emitted });
  }

  send(res, { done: true });
  res.end();
}

// Tries the richest request first and steps down through the parts an account
// might not have, rather than failing outright on a capability it lacks.
async function runRound(req, res, state, params, tools, servers) {
  const withTools = {
    ...params,
    ...(tools.length ? { tools } : {}),
    ...(servers.length ? { mcp_servers: servers } : {})
  };

  const variants = [{ label: "full", params: withTools, betas: betasFor(servers), fallbacks: true }];

  variants.push({
    label: "no-fallback",
    params: withTools,
    betas: servers.length ? [MCP_BETA] : [],
    fallbacks: false
  });

  if (servers.length) {
    variants.push({
      label: "no-connectors",
      params: { ...params, ...(toolsWithoutMcp(tools).length ? { tools: toolsWithoutMcp(tools) } : {}) },
      betas: [],
      fallbacks: false,
      notice: "Your connectors couldn't be reached, so this reply was written without them."
    });
  }

  if (tools.length) {
    variants.push({
      label: "no-tools",
      params,
      betas: [],
      fallbacks: false,
      notice: "Web tools aren't available on this API key, so this reply was written without them."
    });
  }

  let lastError;
  for (const variant of variants) {
    try {
      if (variant.notice) send(res, { notice: variant.notice });
      return await pipe(req, res, state, () => openStream(variant));
    } catch (err) {
      lastError = err;
      // Once bytes are on the wire, retrying would duplicate the reply.
      if (state.emitted || !recoverable(err)) throw err;
      console.warn(`[api/chat] variant "${variant.label}" failed: ${err?.message}`);
    }
  }
  throw lastError;
}

function openStream({ params, betas, fallbacks }) {
  if (!betas.length && !fallbacks) return anthropic().messages.stream(params);

  return anthropic().beta.messages.stream({
    ...params,
    betas: fallbacks ? [...betas, FALLBACK_BETA] : betas,
    ...(fallbacks ? { fallbacks: "default" } : {})
  });
}

async function pipe(req, res, state, start) {
  const stream = start();
  const abort = () => stream.abort?.();
  req.on("close", abort);

  try {
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const activity = describeActivity(event.content_block);
        if (activity) send(res, { activity });
      }

      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        const text = event.delta.text;
        if (!text) continue;
        state.emitted = true;
        send(res, { text });
      }
    }

    return await stream.finalMessage();
  } finally {
    req.off("close", abort);
  }
}

// Turns raw content blocks into the one-line status the UI shows mid-reply.
function describeActivity(block) {
  if (!block) return null;

  if (block.type === "server_tool_use") {
    if (block.name === "web_search") return { kind: "search", label: "Searching the web" };
    if (block.name === "web_fetch") return { kind: "fetch", label: "Reading a page" };
    return { kind: "tool", label: `Running ${block.name}` };
  }

  if (block.type === "mcp_tool_use") {
    const server = block.server_name || "Connector";
    return { kind: "connector", label: `${server} · ${block.name}` };
  }

  if (block.type === "web_search_tool_result") {
    const count = Array.isArray(block.content) ? block.content.length : 0;
    return count ? { kind: "search", label: `Read ${count} result${count === 1 ? "" : "s"}` } : null;
  }

  return null;
}

/* ------------------------------- titles ------------------------------- */

async function handleTitle(res, messages) {
  const opening = messages
    .slice(0, 2)
    .map((m) => `${m.role === "user" ? "Person" : "Selflight"}: ${flatten(m.content)}`)
    .join("\n\n");

  try {
    const message = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 32,
      system: TITLE_PROMPT,
      // A title needs no deliberation, and thinking would eat the token budget.
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: opening }]
    });

    if (message.stop_reason === "refusal") return json(res, 200, { title: null });

    const raw = message.content.find((block) => block.type === "text")?.text || "";
    return json(res, 200, { title: cleanTitle(raw) });
  } catch (err) {
    // Titles are cosmetic — the client falls back to the first message.
    console.warn(`[api/chat] title generation failed: ${err?.message || err}`);
    return json(res, 200, { title: null });
  }
}

function cleanTitle(raw) {
  const title = raw
    .replace(/<[^>]*>/g, "")
    .replace(/["'.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return title && title.length <= 48 ? title : null;
}

/* ------------------------------ assembly ------------------------------ */

function composeSystemPrompt(settings) {
  const parts = [BASE_PROMPT];

  const tone = TONES[settings.tone];
  if (tone) parts.push(tone);

  const length = LENGTHS[settings.length];
  if (length) parts.push(length);

  const callMe = clip(settings.callMe, 60);
  if (callMe) parts.push(`The person you are talking to goes by ${callMe}. Use their name sparingly.`);

  const about = clip(settings.about, 2000);
  if (about) parts.push(`What they've told you about themselves:\n${about}`);

  const instructions = clip(settings.instructions, 2000);
  if (instructions) {
    parts.push(`Standing instructions from them — follow these unless a message overrides:\n${instructions}`);
  }

  return parts.join("\n\n");
}

function toTools(settings, servers) {
  const tools = [];
  if (settings.webSearch !== false) tools.push({ type: "web_search_20260209", name: "web_search" });
  if (settings.webFetch !== false) tools.push({ type: "web_fetch_20260209", name: "web_fetch" });
  // Every declared server must be referenced by exactly one toolset.
  for (const server of servers) tools.push({ type: "mcp_toolset", mcp_server_name: server.name });
  return tools;
}

function toolsWithoutMcp(tools) {
  return tools.filter((t) => t.type !== "mcp_toolset");
}

function toMcpServers(connectors) {
  if (!Array.isArray(connectors)) return [];
  const seen = new Set();

  return connectors
    .filter((c) => c?.enabled !== false && typeof c?.url === "string" && /^https:\/\//i.test(c.url))
    .map((c) => {
      const name = slug(c.name || "connector");
      return { name, url: c.url.trim(), token: typeof c.token === "string" ? c.token.trim() : "" };
    })
    .filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    })
    .slice(0, 8)
    .map((c) => ({
      type: "url",
      name: c.name,
      url: c.url,
      ...(c.token ? { authorization_token: c.token } : {})
    }));
}

function slug(name) {
  const cleaned = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "connector";
}

function clip(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/* ------------------------------ plumbing ------------------------------ */

function betasFor(servers) {
  return servers.length ? [MCP_BETA] : [];
}

function toApiMessages(input) {
  if (!Array.isArray(input)) return [];

  const mapped = input
    .filter((m) => m && !m.error && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }))
    .slice(-CONTEXT_WINDOW);

  // The first message in a request must come from the user.
  while (mapped.length && mapped[0].role !== "user") mapped.shift();
  return mapped;
}

function flatten(content) {
  if (typeof content === "string") return content;
  return (content || []).map((block) => block.text || "").join(" ");
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function recoverable(err) {
  const status = err?.status;
  if (status !== 400 && status !== 403 && status !== 404) return false;
  return /fallback|beta|tool|mcp|unsupported|not available|permission/i.test(err?.message || "");
}

function userFacingError(err) {
  if (err?.status === 429) return "Rate limited. Give it a moment and try again.";
  if (err?.status === 401 || err?.status === 403) {
    return "The API key was rejected. Check ANTHROPIC_API_KEY.";
  }
  if (err?.status >= 500) return "The model is having a moment. Try again.";
  return "Something went wrong reaching the model. Try again.";
}

function sseHead(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
}

function send(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
