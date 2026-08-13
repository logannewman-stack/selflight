// The one route the model is reached through.
//
// It owns the things that are true whichever model answers — who's asking, what
// they're allowed to spend, and the shape of the event stream going back to the
// browser — and hands the actual conversation to a provider. See provider.js.

import { BUILD_PROMPT, TITLE_PROMPT, composeSystemPrompt, toApiMessages } from "./prompt.js";
import { missingKey, provider, providerFor, userFacingError } from "./provider.js";
import { admittedNotKnowing, record } from "./_failures.js";
import {
  connectorsFor,
  hasSupabase,
  recordUsage,
  usageThisMonth,
  userFromRequest
} from "./_supabase.js";

// Searches and multi-step tool use can run well past a default timeout.
export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });

  const missing = missingKey();
  if (missing) return json(res, 500, { error: missing });

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

  const build = body.task === "build";
  const settings = body.settings || {};

  // Connectors come from the database when there's an account, so their tokens
  // never travel through the browser. Only a signed-out local session is
  // trusted to describe its own connectors, and then only to itself.
  const connectors = build ? [] : user ? await connectorsFor(user.id) : body.connectors || [];

  return converse(req, res, {
    system: build ? BUILD_PROMPT : composeSystemPrompt(settings),
    messages,
    settings,
    connectors,
    kind: build ? "build" : "chat",
    user
  });
}

/* ------------------------------ the exchange ----------------------------- */

async function converse(req, res, { system, messages, settings, connectors, kind, user }) {
  // A turn with a connector goes to a model that can call one, if there is one.
  const model = providerFor({ connectors });

  sseHead(res);

  // A closed tab should stop the work rather than keep paying for it.
  const controller = new AbortController();
  const stop = () => controller.abort();
  req.on("close", stop);

  const state = { emitted: false, answer: "" };
  const emit = {
    text: (text) => {
      state.emitted = true;
      // Kept only until the turn ends, and only to ask two questions of it:
      // did anything arrive, and did the assistant say it didn't know. Never
      // stored, never sent anywhere.
      if (state.answer.length < 8000) state.answer += text;
      send(res, { text });
    },
    thinking: (thinking) => send(res, { thinking }),
    activity: (activity) => send(res, { activity }),
    notice: (notice) => send(res, { notice }),
    sources: (sources) => send(res, { sources }),
    error: (error) => send(res, { error })
  };

  // Some of what the interface offers has no equivalent on every provider.
  // Saying so beats a feature that silently does nothing.
  const warning = model.unsupported?.(connectors);
  if (warning) emit.notice(warning);

  let usage = { input: 0, output: 0 };
  const started = Date.now();
  const base = {
    route: "/api/chat",
    provider: model.name,
    kind,
    depth: settings.depth || "balanced",
    connectors: connectors.filter((c) => c?.enabled !== false).length
  };

  const attempt = (extra = {}) =>
    model.converse({
      system,
      messages,
      settings,
      connectors,
      kind,
      signal: controller.signal,
      emit,
      ...extra
    });

  // Filled in if something goes wrong, and filed after the response — a report
  // about a failure must not slow down the recovery from it.
  let failure = null;

  try {
    usage = (await attempt()) || usage;
  } catch (err) {
    // A closed tab isn't a failure and there's nobody left to tell.
    if (err?.name !== "AbortError") {
      console.error(`[api/chat] ${err?.stack || err}`);

      // One recovery, attempted only where it can actually help: nothing has
      // streamed yet, and a connector was in play. A connected tool that won't
      // answer is by far the most common way an otherwise fine turn dies, and
      // answering without it beats failing — provided the person is told that's
      // what happened, which is what the notice is for.
      let recovered = false;

      if (!state.emitted && base.connectors > 0) {
        try {
          emit.notice("A connected tool didn't answer, so this reply was written without it.");
          usage = (await attempt({ connectors: [] })) || usage;
          recovered = state.emitted;
        } catch (second) {
          console.error(`[api/chat] retry without connectors also failed: ${second?.message}`);
        }
      }

      if (!recovered) send(res, { error: userFacingError(err), partial: state.emitted });

      failure = {
        kind: base.connectors ? "connector" : "model",
        severity: recovered ? "degraded" : "error",
        summary: `${model.name} failed to answer a ${kind} turn`,
        detail: err?.stack || String(err?.message || err),
        context: { ...base, ms: Date.now() - started, streamed: state.emitted },
        recovered,
        recovery: recovered ? "Answered again with the connectors removed." : null,
        userId: user?.id
      };
    }
  } finally {
    req.off("close", stop);
  }

  send(res, { done: true });
  res.end();

  if (failure) await record(failure);

  // Everything below happens after the reply is on screen, so no bookkeeping
  // can delay or break an answer that already worked.
  //
  // The provider reports which model it actually used — "sonar-reasoning-pro",
  // not "Perplexity". The rate table is keyed by model id, so passing the
  // provider's display name here would price every call as unknown and quietly
  // make the margin figure fiction.
  if (user) await recordUsage(user.id, { kind, ...usage });

  // Saying "I don't know" is the behaviour we want, not a bug — and it is also
  // the clearest evidence there is of what the product can't do yet, which is
  // worth writing down rather than scrolling past.
  const admission = admittedNotKnowing(state.answer);
  if (admission) {
    await record({
      kind: "unknown",
      severity: "unknown",
      summary: "The assistant said it didn't know",
      detail: admission,
      context: { ...base, ms: Date.now() - started },
      userId: user?.id
    });
  }
}

/* -------------------------------- titles --------------------------------- */

async function handleTitle(res, messages, user) {
  const model = provider();

  const opening = messages
    .slice(0, 2)
    .map((m) => `${m.role === "user" ? "Person" : "Selflight"}: ${flatten(m.content)}`)
    .join("\n\n");

  try {
    const { text, usage } = await model.title({
      messages: [{ role: "user", content: opening }],
      prompt: TITLE_PROMPT
    });

    if (user) await recordUsage(user.id, { kind: "title", model: model.name, ...usage });
    return json(res, 200, { title: cleanTitle(text) });
  } catch (err) {
    // Titles are cosmetic — the client falls back to the first message.
    console.warn(`[api/chat] title generation failed: ${err?.message || err}`);
    return json(res, 200, { title: null });
  }
}

function cleanTitle(raw) {
  const title = String(raw || "")
    // Reasoning models narrate before answering; a title is only what's left.
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/["'.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return title && title.length <= 48 ? title : null;
}

/* ------------------------------- plumbing -------------------------------- */

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
