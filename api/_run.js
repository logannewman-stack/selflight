// Running one routine, and putting the answer where it was asked to go.
//
// Called from two places: "Run now" in the interface, and the scheduler. Both
// go through here so a routine can't behave one way when you test it and
// another way at six in the morning.

import { composeSystemPrompt } from "./prompt.js";
import { provider } from "./provider.js";
import { db, hasSupabase, projectFor, recordUsage, usageThisMonth } from "./_supabase.js";
import { record } from "./_failures.js";
import { costOf } from "./_pricing.js";

// A routine answers into nothing and nobody is watching, so it gets less rope
// than a chat: enough for a real briefing, not enough to be surprising.
const MAX_ANSWER = 12_000;
const TIMEOUT_MS = 90_000;

/**
 * Runs a routine end to end and files what happened.
 *
 * Always writes a routine_runs row, including when it fails. A routine that
 * silently stopped producing anything is the failure mode worth being able to
 * see, and without a row "it ran and the answer was empty" is indistinguishable
 * from "it never ran at all".
 */
export async function runRoutine(routine, { manual = false } = {}) {
  const started = Date.now();
  const deliver = Array.isArray(routine.deliver) ? routine.deliver : ["chat"];

  const finish = async (result) => {
    const ms = Date.now() - started;
    if (hasSupabase) {
      await db()
        .from("routine_runs")
        .insert({
          routine_id: routine.id,
          user_id: routine.user_id,
          chat_id: result.chatId || null,
          status: result.status,
          summary: result.summary?.slice(0, 300) || null,
          detail: result.detail?.slice(0, 1000) || null,
          delivered: result.delivered || [],
          input_tokens: result.usage?.input || 0,
          output_tokens: result.usage?.output || 0,
          cost_micros: result.usage?.costMicros || 0,
          ms
        });
    }
    return { ...result, ms };
  };

  // The month's allowance applies to routines too. A routine is the easiest way
  // to spend a cap without noticing, since nobody is sitting there watching it.
  const usage = await usageThisMonth(routine.user_id);
  if (usage.exceeded) {
    return finish({
      status: "skipped",
      summary: "Skipped — this month's allowance is used up.",
      detail: `The cap is ${usage.cap.toLocaleString()} tokens and resets on the 1st.`,
      delivered: []
    });
  }

  const model = provider();
  if (!model.configured()) {
    return finish({
      status: "failed",
      summary: "Skipped — no model key is configured.",
      detail: `Set ${model.keyName}.`,
      delivered: []
    });
  }

  /* ------------------------------- the answer ----------------------------- */

  const project = await projectFor(routine.user_id, routine.project_id);
  const settings = await settingsFor(routine.user_id);

  const system = composeSystemPrompt(settings, {
    projectName: project?.name,
    projectInstructions: project?.instructions
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let answer = "";
  let sources = [];
  const emit = {
    text: (text) => {
      if (answer.length < MAX_ANSWER) answer += text;
    },
    // A routine has no screen, so everything but the answer is discarded rather
    // than accumulated and thrown away later.
    thinking: () => {},
    activity: () => {},
    notice: () => {},
    sources: (found) => {
      sources = found;
    },
    error: () => {}
  };

  let tokens = { input: 0, output: 0 };
  try {
    tokens = await model.converse({
      system,
      messages: [{ role: "user", content: routine.prompt }],
      settings,
      connectors: [],
      kind: "chat",
      signal: controller.signal,
      emit
    });
  } catch (err) {
    clearTimeout(timer);
    const detail = model.describeError?.(err) || err?.message || String(err);

    await record({
      kind: "routine",
      severity: "error",
      summary: `Routine "${routine.name}" couldn't get an answer`,
      detail,
      context: { routineId: routine.id, manual }
    });

    return finish({
      status: "failed",
      summary: "Couldn't get an answer.",
      detail,
      delivered: []
    });
  }
  clearTimeout(timer);

  if (!answer.trim()) {
    return finish({
      status: "failed",
      summary: "The model returned nothing.",
      detail: "No text came back. Nothing was delivered.",
      delivered: [],
      usage: await bill(routine, tokens, model)
    });
  }

  const spent = await bill(routine, tokens, model);

  /* ------------------------------- delivery ------------------------------- */

  const delivered = [];
  const problems = [];
  let chatId = null;

  if (deliver.includes("chat")) {
    chatId = await asChat(routine, answer, sources);
    if (chatId) delivered.push("chat");
    else problems.push("couldn't save it as a chat");
  }

  if (deliver.includes("email")) {
    const sent = await asEmail(routine, answer);
    if (sent === true) delivered.push("email");
    else problems.push(sent);
  }

  if (deliver.includes("webhook")) {
    const sent = await asWebhook(routine, answer, chatId);
    if (sent === true) delivered.push("webhook");
    else problems.push(sent);
  }

  // Delivered nowhere is a failure even though the model answered — the answer
  // exists and nobody can see it, which is the same as no answer.
  const status = delivered.length ? "ok" : "failed";
  if (!delivered.length) {
    await record({
      kind: "routine",
      severity: "error",
      summary: `Routine "${routine.name}" ran but reached nobody`,
      detail: problems.join("; "),
      context: { routineId: routine.id }
    });
  }

  return finish({
    status,
    chatId,
    summary: firstLine(answer),
    detail: problems.length ? problems.join("; ") : null,
    delivered,
    answer,
    usage: spent
  });
}

/* ------------------------------- the channels ----------------------------- */

async function asChat(routine, answer, sources) {
  if (!hasSupabase) return null;

  const title = `${routine.name} — ${new Date().toISOString().slice(0, 10)}`;

  const { data, error } = await db()
    .from("chats")
    .insert({ user_id: routine.user_id, title, project_id: routine.project_id || null })
    .select("id")
    .single();

  if (error || !data) {
    console.error(`[routines] couldn't start a chat: ${error?.message}`);
    return null;
  }

  // Written as a real two-message conversation, so it can be carried on from
  // the interface exactly like any other. A routine's output being a dead end
  // would be the most annoying thing about it.
  const { error: failed } = await db().from("messages").insert([
    {
      chat_id: data.id,
      position: 0,
      user_id: routine.user_id,
      role: "user",
      content: routine.prompt
    },
    {
      chat_id: data.id,
      position: 1,
      user_id: routine.user_id,
      role: "selflight",
      content: answer,
      sources: sources || []
    }
  ]);

  if (failed) {
    console.error(`[routines] couldn't write the messages: ${failed.message}`);
    return null;
  }
  return data.id;
}

// Email goes out through the same webhook the failure log uses, because that's
// the piece already wired to something that can send one. Without it set, this
// says so rather than reporting a delivery that never happened.
async function asEmail(routine, answer) {
  const hook = process.env.N8N_WEBHOOK_URL;
  if (!hook) return "no email service is configured (set N8N_WEBHOOK_URL)";

  try {
    const res = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "routine.email",
        to: routine.email,
        subject: routine.name,
        body: answer
      }),
      signal: AbortSignal.timeout(8000)
    });
    return res.ok ? true : `the email service answered ${res.status}`;
  } catch (err) {
    return `couldn't reach the email service: ${err.message}`;
  }
}

async function asWebhook(routine, answer, chatId) {
  try {
    const res = await fetch(routine.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        routine: routine.name,
        prompt: routine.prompt,
        answer,
        chatId,
        at: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(8000)
    });
    return res.ok ? true : `the webhook answered ${res.status}`;
  } catch (err) {
    return `couldn't reach the webhook: ${err.message}`;
  }
}

/* -------------------------------- plumbing -------------------------------- */

async function settingsFor(userId) {
  if (!hasSupabase) return {};
  const { data } = await db()
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.settings || {};
}

async function bill(routine, tokens, model) {
  const input = tokens?.input || 0;
  const output = tokens?.output || 0;

  // Worked out here rather than read back from recordUsage, which returns
  // nothing — taking its return value would have written 0 on every routine run
  // and made routines look free.
  const costMicros = costOf({
    model: model.name,
    input,
    output,
    searched: tokens?.searched !== false
  });

  try {
    await recordUsage(routine.user_id, { kind: "routine", model: model.name, ...tokens });
  } catch (err) {
    console.warn(`[routines] couldn't record usage: ${err.message}`);
  }
  return { input, output, costMicros };
}

export function firstLine(text) {
  const clean = String(text || "")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 160 ? `${clean.slice(0, 160).trimEnd()}…` : clean;
}
