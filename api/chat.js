import Anthropic from "@anthropic-ai/sdk";

// Long replies stream for a while; give the function room to finish.
export const config = { maxDuration: 60 };

const MODEL = "claude-opus-5";

// Effort controls how much the model thinks before answering. `medium` keeps
// chat replies quick; raise to "high" if answers feel shallow.
const EFFORT = "medium";
const MAX_TOKENS = 64000;

// Turns kept in the prompt. Older turns drop off so long chats stay affordable.
const CONTEXT_WINDOW = 40;

// Re-runs a request on another model when safety classifiers decline it, so a
// false positive doesn't dead-end the conversation.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const SYSTEM_PROMPT = `You are Selflight, a general-purpose AI assistant.

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

Length:
- Keep responses focused and concise so you don't overwhelm the person. Match length to the question — a short question gets a short answer.
- Keep caveats and disclaimers brief; spend the response on the actual answer.
- When asked to explain something, give a high-level answer unless depth was specifically requested.

Format:
- Prose by default, in short paragraphs.
- Lists only when the content is genuinely a list.
- Code in fenced blocks with a language tag.
- Headers only when the answer is long enough to need them.`;

const TITLE_SYSTEM = `Write a title for the conversation the user shows you: 2 to 5 words, plain capitalization, no quotes, no trailing period. Reply with the title and nothing else. Do not include internal or system XML tags in your response.`;

const REFUSAL_TEXT =
  "I can't help with that one. Try rephrasing it, or ask me something else.";

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
  return handleChat(req, res, messages);
}

/* ------------------------------- chat ------------------------------- */

async function handleChat(req, res, messages) {
  const params = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: { effort: EFFORT },
    // Caches the conversation prefix so each turn re-reads it cheaply.
    cache_control: { type: "ephemeral" },
    messages
  };

  sseHead(res);
  const state = { emitted: false };

  try {
    try {
      await pipe(req, res, state, () =>
        anthropic().beta.messages.stream({
          ...params,
          betas: [FALLBACK_BETA],
          fallbacks: "default"
        })
      );
    } catch (err) {
      // The refusal-fallback beta isn't enabled on every account. If it was
      // rejected before any text reached the browser, run the plain request.
      if (state.emitted || !isBetaRejection(err)) throw err;
      console.warn("[api/chat] refusal fallback unavailable; continuing without it");
      await pipe(req, res, state, () => anthropic().messages.stream(params));
    }
  } catch (err) {
    console.error(`[api/chat] ${err?.stack || err}`);
    send(res, { error: userFacingError(err), partial: state.emitted });
  }

  send(res, { done: true });
  res.end();
}

async function pipe(req, res, state, start) {
  const stream = start();
  const abort = () => stream.abort?.();
  req.on("close", abort);

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        const text = event.delta.text;
        if (!text) continue;
        state.emitted = true;
        send(res, { text });
      }
    }

    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal" && !state.emitted) {
      send(res, { error: REFUSAL_TEXT });
    }
  } finally {
    req.off("close", abort);
  }
}

/* ------------------------------- titles ------------------------------ */

async function handleTitle(res, messages) {
  const opening = messages
    .slice(0, 2)
    .map((m) => `${m.role === "user" ? "Person" : "Selflight"}: ${flatten(m.content)}`)
    .join("\n\n");

  try {
    const message = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 32,
      system: TITLE_SYSTEM,
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

/* ------------------------------ helpers ------------------------------ */

function toApiMessages(input) {
  if (!Array.isArray(input)) return [];

  const mapped = input
    .filter((m) => m && !m.error && typeof m.text === "string" && m.text.trim())
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text
    }))
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

function isBetaRejection(err) {
  const status = err?.status;
  if (status !== 400 && status !== 403 && status !== 404) return false;
  return /fallback|beta/i.test(err?.message || "");
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
