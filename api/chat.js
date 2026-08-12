import Anthropic from "@anthropic-ai/sdk";
import {
  BUILD_PROMPT,
  TITLE_PROMPT,
  composeSystemPrompt,
  effortFor,
  toApiMessages,
  toMcpServers,
  toTools,
  toolsWithoutMcp
} from "./prompt.js";
import {
  connectorsFor,
  hasSupabase,
  recordUsage,
  usageThisMonth,
  userFromRequest
} from "./_supabase.js";

// Searches and multi-step tool use can run well past a default timeout.
export const config = { maxDuration: 120 };

const MODEL = "claude-opus-5";
const MAX_TOKENS = 64000;


// Server-side tools pause after a batch of work and expect to be resumed.
const MAX_CONTINUATIONS = 6;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MCP_BETA = "mcp-client-2025-11-20";







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

  // With a Supabase project configured, a sign-in is required. Otherwise the
  // first person to find the URL spends the API key's budget for everyone.
  let user = null;
  if (hasSupabase) {
    user = await userFromRequest(req);
    if (!user) return json(res, 401, { error: "Your session expired. Sign in again." });

    const usage = await usageThisMonth(user.id);
    if (usage.exceeded) {
      return json(res, 429, {
        error: `You've used this month's allowance of ${usage.cap.toLocaleString()} tokens. It resets on the 1st.`
      });
    }
  }

  if (body.task === "title") return handleTitle(res, messages, user);
  if (body.task === "build") return handleBuild(req, res, messages, user);

  // Connectors come from the database when there's an account, so their tokens
  // never travel through the browser. Only a signed-out local session is
  // trusted to describe its own connectors, and then only to itself.
  const connectors = user ? await connectorsFor(user.id) : body.connectors || [];
  return handleChat(req, res, messages, body.settings || {}, connectors, user);
}

/* -------------------------------- chat -------------------------------- */

async function handleChat(req, res, messages, settings, connectors, user) {
  const servers = toMcpServers(connectors);
  const tools = toTools(settings, servers);

  const base = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: composeSystemPrompt(settings),
    output_config: { effort: effortFor(settings) },
    // Caches the conversation prefix so each turn re-reads it cheaply.
    cache_control: { type: "ephemeral" }
  };

  await converse(req, res, { base, messages, tools, servers, user });
}

async function handleBuild(req, res, messages, user) {
  const base = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: BUILD_PROMPT,
    // Generated pages are worth more thinking than a chat reply.
    output_config: { effort: "high" },
    cache_control: { type: "ephemeral" }
  };

  await converse(req, res, { base, messages, tools: [], servers: [], user, kind: "build" });
}

async function converse(req, res, { base, messages, tools, servers, user, kind = "chat" }) {
  sseHead(res);
  const state = { emitted: false, input: 0, output: 0 };
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

  // After the response, so bookkeeping never delays the reply. A paused turn
  // bills for each round, so these are summed across all of them.
  if (user) {
    await recordUsage(user.id, { kind, model: MODEL, input: state.input, output: state.output });
  }
}

function tally(state, message) {
  const usage = message?.usage;
  if (!usage) return;
  state.input +=
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  state.output += usage.output_tokens || 0;
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

    const message = await stream.finalMessage();
    tally(state, message);
    return message;
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

async function handleTitle(res, messages, user) {
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

    if (user) {
      const state = { input: 0, output: 0 };
      tally(state, message);
      await recordUsage(user.id, { kind: "title", model: MODEL, ...state });
    }

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

/* ------------------------------ plumbing ------------------------------ */

function betasFor(servers) {
  return servers.length ? [MCP_BETA] : [];
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
