// Anthropic's Claude, kept as the alternative provider.
//
// It costs more than Sonar and doesn't search by default, but it's the one that
// supports MCP connectors and writes replies long enough for the Code workspace
// to produce a real page. Set ANTHROPIC_API_KEY instead of PERPLEXITY_API_KEY
// and Polstar uses this.

import Anthropic from "@anthropic-ai/sdk";
import { effortFor, toMcpServers, toTools, toolsWithoutMcp } from "../prompt.js";
import { MODELS, modelFor, supportsEffort } from "../_pricing.js";
import { callApi, toolFor, toolResult } from "../_apis.js";

export const name = "Claude";
export const keyName = "ANTHROPIC_API_KEY";

export const configured = () => Boolean(process.env.ANTHROPIC_API_KEY);

// Claude can call an MCP server, which is what makes a connected account worth
// having. provider.js routes a turn with active connectors here when it can.
export const supportsConnectors = true;

// Which Claude answers is the Quick/Balanced/Deep dial, not a constant — see
// _pricing.js. Titles are the exception: they're a fixed, trivial job nobody
// chose a depth for, so they always run on the cheapest model.
const TITLE_MODEL = MODELS.quick;
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

/**
 * The request every turn is built from — exported so its shape can be tested
 * without a network call, which is the only way to catch the failure this
 * function exists to prevent.
 *
 * Effort and adaptive thinking are 5-series features. On a model that predates
 * them both fields are a 400, so the whole block is gated rather than sent
 * hopefully — routing Quick to Haiku without this would have failed every
 * single Quick request, on the first one, in production.
 *
 * `display: "summarized"` is not optional if the thinking panel is to show
 * anything. These models default it to "omitted", which still streams thinking
 * blocks — with empty text. Without this the panel renders nothing, forever,
 * and never errors, which is the kind of broken nobody files a bug about.
 */
export function baseRequest({ model, system, settings = {}, build = false }) {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system,
    ...(supportsEffort(model)
      ? {
          // Generated pages are worth more thinking than a chat reply.
          output_config: { effort: build ? "high" : effortFor(settings) },
          thinking: { type: "adaptive", display: "summarized" }
        }
      : {}),
    // Caches the conversation prefix so each turn re-reads it cheaply.
    cache_control: { type: "ephemeral" }
  };
}

export async function converse({ system, messages, settings = {}, connectors = [], kind, plan = null, signal, emit }) {
  const build = kind === "build";
  // A generated page is worth the best model whatever dial the chat is set to;
  // everything else follows the person's choice, bounded by their plan.
  const model = build ? MODELS.deep : modelFor(settings, plan);
  const servers = build ? [] : toMcpServers(connectors);
  // Connectors come in two kinds. An MCP server is handed to Anthropic and run
  // on their side; a plain API is a tool we define here and call ourselves.
  const apis = build
    ? []
    : connectors.filter((c) => c.kind === "http" && c.enabled !== false && c.baseUrl);
  const tools = build ? [] : [...toTools(settings, servers), ...apis.map((c) => toolFor(toRow(c)))];

  const base = baseRequest({ model, system, settings, build });

  const state = { emitted: false, input: 0, output: 0, searched: false };
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

  // `searched` is now whether the model actually ran a search, not whether it
  // was allowed to. The old version reported the setting, so every reply was
  // billed a 1¢ search fee it mostly hadn't incurred — about a third of the
  // apparent cost of a message, and wrong in the direction that makes the
  // business look worse than it is. state.searched is set by pipe() when a
  // web_search block actually appears in the stream.
  return {
    input: state.input,
    output: state.output,
    model,
    searched: state.searched
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
        const block = event.content_block;
        // The one place that knows a search really happened.
        if (block?.type === "server_tool_use" && block.name === "web_search") {
          state.searched = true;
        }
        const activity = describeActivity(block);
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
    model: TITLE_MODEL,
    max_tokens: 32,
    system: prompt,
    // A title needs no deliberation, and thinking would eat the token budget.
    // Both fields are gated: on the cheap model they'd be a 400, and it doesn't
    // think by default anyway, so omitting them is the same behaviour.
    ...(supportsEffort(TITLE_MODEL)
      ? { thinking: { type: "disabled" }, output_config: { effort: "low" } }
      : {}),
    messages
  });

  if (message.stop_reason === "refusal") return { text: "", usage: { input: 0, output: 0 } };

  return {
    text: message.content.find((block) => block.type === "text")?.text || "",
    model: TITLE_MODEL,
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
