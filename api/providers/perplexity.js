// Perplexity's Sonar models, which answer from a live web search rather than
// from training data alone. That's the trade this provider makes: answers come
// with sources attached and stay current, and in exchange there are no MCP
// connectors and shorter replies than a frontier model will write.
//
// The API is OpenAI-shaped, so this is a plain fetch and an SSE reader — no SDK.

import { tierFor } from "../prompt.js";

// Overridable so the stream handling can be tested against a stand-in, and so a
// gateway or regional proxy can be slotted in without touching this file.
const endpoint = () =>
  `${process.env.PERPLEXITY_BASE_URL || "https://api.perplexity.ai"}/chat/completions`;

export const name = "Perplexity";
export const keyName = "PERPLEXITY_API_KEY";

export const configured = () => Boolean(process.env.PERPLEXITY_API_KEY);

// Sonar's per-request search fee scales with how much of the web it pulls in,
// so answer depth and cost are the same dial. Left in prompt.js next to the
// other settings translations, and tested there.
export { tierFor };

// Sonar tops out well below a frontier model's output. Asking for more than the
// model can give just produces a truncated reply that looks like a bug.
const MAX_TOKENS = 4000;
const BUILD_MAX_TOKENS = 8000;

export async function converse({ system, messages, settings = {}, kind = "chat", signal, emit }) {
  const tier = tierFor(settings);

  const body = {
    model: tier.model,
    messages: [{ role: "system", content: system }, ...messages],
    stream: true,
    max_tokens: kind === "build" ? BUILD_MAX_TOKENS : MAX_TOKENS,
    ...searchOptions(settings, kind)
  };

  return await stream(body, { signal, emit, reasoning: tier.reasoning });
}

// Building a page is a generation task, not a research one — searching the web
// for it spends the per-request fee to no purpose.
function searchOptions(settings, kind) {
  if (kind === "build" || settings.webSearch === false) return { disable_search: true };

  return {
    // Let the model skip the search when the question doesn't need one. The
    // search fee is per request that actually searches, so this is the cheapest
    // switch in the file.
    enable_search_classifier: true,
    web_search_options: { search_context_size: tierFor(settings).context }
  };
}

/* -------------------------------- the wire ------------------------------- */

async function stream(body, { signal, emit, reasoning }) {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok || !res.body) throw await apiError(res);

  const filter = thinkFilter();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let usage = { input: 0, output: 0 };
  let emittedSources = false;
  let sent = "";
  let thinking = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }

      if (chunk.usage) {
        usage = {
          input: chunk.usage.prompt_tokens || 0,
          output: chunk.usage.completion_tokens || 0
        };
      }

      const sources = toSources(chunk);
      if (sources.length && !emittedSources) {
        emittedSources = true;
        emit.sources(sources);
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      // Deltas normally, but a cumulative `message.content` shows up in some
      // responses; taking the suffix handles both without guessing which.
      let piece = choice.delta?.content ?? "";
      if (!piece && typeof choice.message?.content === "string") {
        piece = choice.message.content.slice(sent.length);
      }
      if (!piece) continue;
      sent += piece;

      const step = filter(piece);

      // Reasoning models narrate inside <think> tags before answering. That
      // narration is worth reading, so it goes out as its own kind of content
      // rather than being dropped — the interface shows it quietly, above the
      // answer, while the answer is still being written.
      if (step.reasoning) emit.thinking(step.reasoning);

      if (reasoning && step.thinking !== thinking) {
        thinking = step.thinking;
        if (thinking) emit.activity({ kind: "tool", label: "Thinking it through" });
      }

      if (step.text) emit.text(step.text);
    }
  }

  return usage;
}

function toSources(chunk) {
  const results = chunk.search_results || chunk.citations;
  if (!Array.isArray(results)) return [];

  return results
    .map((entry, i) =>
      typeof entry === "string"
        ? { title: hostOf(entry) || `Source ${i + 1}`, url: entry }
        : { title: entry.title || hostOf(entry.url) || `Source ${i + 1}`, url: entry.url }
    )
    .filter((s) => typeof s.url === "string" && /^https?:\/\//i.test(s.url))
    .slice(0, 12);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/* ------------------------------ <think> tags ----------------------------- */

// A tag can be split across two chunks, so the tail of anything that might
// still become one is held back rather than emitted and regretted.
function partialTail(text, tag) {
  const max = Math.min(text.length, tag.length - 1);
  for (let k = max; k > 0; k--) if (text.endsWith(tag.slice(0, k))) return k;
  return 0;
}

// Splits a stream into the answer and the reasoning that preceded it. Both come
// out: the answer is the reply, and the reasoning is shown quietly above it
// while the model is still working.
function thinkFilter() {
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let inside = false;
  let held = "";

  return (chunk) => {
    let buffer = held + chunk;
    held = "";
    let out = "";
    let reasoning = "";

    while (buffer) {
      const tag = inside ? CLOSE : OPEN;
      const at = buffer.indexOf(tag);

      if (at !== -1) {
        (inside ? (reasoning += buffer.slice(0, at)) : (out += buffer.slice(0, at)));
        buffer = buffer.slice(at + tag.length);
        inside = !inside;
        continue;
      }

      const keep = partialTail(buffer, tag);
      const usable = buffer.slice(0, buffer.length - keep);
      if (inside) reasoning += usable;
      else out += usable;

      held = buffer.slice(buffer.length - keep);
      buffer = "";
    }

    return { text: out, reasoning, thinking: inside };
  };
}

/* -------------------------------- titles --------------------------------- */

export async function title({ messages, prompt }) {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "system", content: prompt }, ...messages],
      max_tokens: 24,
      // Naming a conversation needs no research, and a search fee for a title
      // would be most of what the title cost.
      disable_search: true
    })
  });

  if (!res.ok) throw await apiError(res);

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: {
      input: data.usage?.prompt_tokens || 0,
      output: data.usage?.completion_tokens || 0
    }
  };
}

/* -------------------------------- errors --------------------------------- */

async function apiError(res) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.detail || "";
  } catch {
    detail = await res.text().catch(() => "");
  }

  const err = new Error(detail || `Perplexity returned ${res.status}.`);
  err.status = res.status;
  return err;
}

export function describeError(err) {
  if (err?.status === 401 || err?.status === 403) {
    return "Perplexity rejected the API key. Check PERPLEXITY_API_KEY.";
  }
  if (err?.status === 402) return "Perplexity says the account is out of credit.";
  if (err?.status === 429) return "Rate limited by Perplexity. Give it a moment and try again.";
  if (err?.status >= 500) return "Perplexity is having a moment. Try again.";

  // A 400 is nearly always this deployment's fault — a model name that moved,
  // a parameter the account can't use. Passing the API's own words through is
  // the difference between a five-minute fix and an afternoon. It's Perplexity
  // talking about the request, not anything the user typed.
  if (err?.status === 400 && err.message) return `Perplexity rejected the request: ${err.message}`;
  return null;
}

// Selflight's connector panel offers MCP servers, which Sonar has no equivalent
// for. Saying so once, in the thread, beats a feature that silently does
// nothing.
export function unsupported(connectors = []) {
  const live = connectors.filter((c) => c?.enabled !== false).length;
  if (!live) return null;
  return `MCP connectors don't work on Perplexity's API — it has no equivalent — so this reply was written without ${
    live === 1 ? "your connector" : `your ${live} connectors`
  }.`;
}

// Exported for the tests: the <think> stripping and the source list are the two
// pieces of stream handling that can silently go wrong.
export const _internals = { thinkFilter, toSources };
