// Anthropic's Claude, kept as the alternative provider.
//
// It costs more than Sonar and doesn't search by default, but it's the one that
// supports MCP connectors and writes replies long enough for the Code workspace
// to produce a real page. Set ANTHROPIC_API_KEY instead of PERPLEXITY_API_KEY
// and Selflight uses this.

import Anthropic from "@anthropic-ai/sdk";
import { effortFor, toMcpServers, toTools, toolsWithoutMcp } from "../prompt.js";
import { callApi, toolFor, toolResult } from "../_apis.js";

export const name = "Claude";
export const keyName = "ANTHROPIC_API_KEY";

export const configured = () => Boolean(process.env.ANTHROPIC_API_KEY);

// Claude can call an MCP server, which is what makes a connected account worth
// having. provider.js routes a turn with active connectors here when it can.
export const supportsConnectors = true;

const MODEL = "claude-opus-5";
const MAX_TOKENS = 64000;

// Server-side tools pause after a batch of work and expect to be resumed.
const MAX_CONTINUATIONS = 6;

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MCP_BETA = "mcp-client-2025-11-20";

let client;

function anthropic() {
  if (!client) client = new Anthropic();
  return client;
}

export async function converse({ system, messages, settings = {}, connectors = [], kind, signal, emit }) {
  const build = kind === "build";
  const servers = build ? [] : toMcpServers(connectors);
  // Connectors come in two kinds. An MCP server is handed to Anthropic and run
  // on their side; a plain API is a tool we define here and call ourselves.
  const apis = build
    ? []
    : connectors.filter((c) => c.kind === "http" && c.enabled !== false && c.baseUrl);
  const tools = build ? [] : [...toTools(settings, servers), ...apis.map((c) => toolFor(toRow(c)))];

  const base = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    // Generated pages are worth more thinking than a chat reply.
    output_config: { effort: build ? "high" : effortFor(settings) },
    // Caches the conversation prefix so each turn re-reads it cheaply.
    cache_control: { type: "ephemeral" }
  };

  const state = { emitted: false, input: 0, output: 0 };
  let history = messages;

  for (let round = 0; round < MAX_CONTINUATIONS; round++) {
    const message = await runRound(state, { ...base, messages: history }, tools, servers, {
      signal,
      emit
    });

    // Server-side tools hit their per-request iteration cap; resuming picks the
    // work back up where it stopped.
    if (message?.stop_reason === "pause_turn") {
      history = [...history, { role: "assistant", content: message.content }];
      continue;
    }

    // A tool Claude can't run itself — an API the person connected. Anthropic
    // runs its own tools and its own MCP servers; these are ours, so the call
    // happens here and the answer goes back as another turn.
    if (message?.stop_reason === "tool_use") {
      const asked = (message.content || []).filter((block) => block.type === "tool_use");
      if (!asked.length) break;

      const results = [];
      for (const call of asked) {
        const connector = apis.find((c) => toolFor(toRow(c)).name === call.name);
        if (!connector) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: `No connector called ${call.name} is available.`
          });
          continue;
        }

        emit.activity({ kind: "connector", label: `${connector.name} · ${call.input?.method || "GET"} ${call.input?.path || ""}`.trim() });
        const answer = await callApi(toRow(connector), call.input || {}, {
          credential: connector.token || null
        });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          is_error: answer.ok === false,
          content: toolResult(connector, answer)
        });
      }

      history = [
        ...history,
        { role: "assistant", content: message.content },
        { role: "user", content: results }
      ];
      continue;
    }

    if (message?.stop_reason === "refusal" && !state.emitted) {
      emit.error("I can't help with that one. Try rephrasing it, or ask me something else.");
    }
    break;
  }

  // `searched` follows whether web search was actually available this turn:
  // Claude's search is a tool with a per-request fee, so a turn that never
  // reached for it never paid one.
  return {
    input: state.input,
    output: state.output,
    model: MODEL,
    searched: settings.webSearch !== false
  };
}

// Tries the richest request first and steps down through the parts an account
// might not have, rather than failing outright on a capability it lacks.
async function runRound(state, params, tools, servers, io) {
  const withTools = {
    ...params,
    ...(tools.length ? { tools } : {}),
    ...(servers.length ? { mcp_servers: servers } : {})
  };

  const variants = [
    { label: "full", params: withTools, betas: servers.length ? [MCP_BETA] : [], fallbacks: true },
    {
      label: "no-fallback",
      params: withTools,
      betas: servers.length ? [MCP_BETA] : [],
      fallbacks: false
    }
  ];

  if (servers.length) {
    variants.push({
      label: "no-connectors",
      params: {
        ...params,
        ...(toolsWithoutMcp(tools).length ? { tools: toolsWithoutMcp(tools) } : {})
      },
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
      if (variant.notice) io.emit.notice(variant.notice);
      return await pipe(state, () => openStream(variant), io);
    } catch (err) {
      lastError = err;
      // Once bytes are on the wire, retrying would duplicate the reply.
      if (state.emitted || !recoverable(err)) throw err;
      console.warn(`[anthropic] variant "${variant.label}" failed: ${err?.message}`);
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

async function pipe(state, start, { signal, emit }) {
  const stream = start();
  const abort = () => stream.abort?.();
  signal?.addEventListener("abort", abort);

  try {
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const activity = describeActivity(event.content_block);
        if (activity) emit.activity(activity);
      }

      // Claude thinks in its own block type rather than in tags inside the
      // reply, so it arrives already separated.
      if (event.type === "content_block_delta" && event.delta?.type === "thinking_delta") {
        if (event.delta.thinking) emit.thinking(event.delta.thinking);
      }

      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        const text = event.delta.text;
        if (!text) continue;
        state.emitted = true;
        emit.text(text);
      }
    }

    const message = await stream.finalMessage();
    const usage = message?.usage;
    if (usage) {
      state.input +=
        (usage.input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) +
        (usage.cache_read_input_tokens || 0);
      state.output += usage.output_tokens || 0;
    }
    return message;
  } finally {
    signal?.removeEventListener("abort", abort);
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

function recoverable(err) {
  const status = err?.status;
  if (status !== 400 && status !== 403 && status !== 404) return false;
  return /fallback|beta|tool|mcp|unsupported|not available|permission/i.test(err?.message || "");
}

/* -------------------------------- titles --------------------------------- */

export async function title({ messages, prompt }) {
  const message = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 32,
    system: prompt,
    // A title needs no deliberation, and thinking would eat the token budget.
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    messages
  });

  if (message.stop_reason === "refusal") return { text: "", usage: { input: 0, output: 0 } };

  return {
    text: message.content.find((block) => block.type === "text")?.text || "",
    usage: {
      input: message.usage?.input_tokens || 0,
      output: message.usage?.output_tokens || 0
    }
  };
}

export function describeError(err) {
  if (err?.status === 401 || err?.status === 403) {
    return "The API key was rejected. Check ANTHROPIC_API_KEY.";
  }
  if (err?.status === 429) return "Rate limited. Give it a moment and try again.";
  if (err?.status >= 500) return "The model is having a moment. Try again.";
  return null;
}

// Claude supports everything the interface offers, so there is nothing to warn
// about.
export function unsupported() {
  return null;
}


// The browser and the database spell these differently; _apis.js speaks the
// database's dialect, so this is the one place the two meet.
function toRow(connector) {
  return {
    name: connector.name,
    base_url: connector.baseUrl,
    auth_style: connector.authStyle || "bearer",
    auth_name: connector.authName || null,
    methods: connector.methods,
    description: connector.description,
    docs: connector.docs
  };
}
