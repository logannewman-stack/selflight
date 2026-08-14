// Talks to /api/chat. The model is never called from the browser — the API key
// stays on the server, which is what makes this safe to deploy publicly.

import { accessToken } from "./supabase.js";

const ENDPOINT = "/api/chat";

// The server needs to know who's asking: it looks up their connectors, counts
// their usage against the monthly cap, and refuses the request outright if the
// token doesn't check out.
async function headers() {
  const token = await accessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function post(payload, signal) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(payload),
    signal
  });

  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error || "Couldn't reach Selflight. Try again.");
  }
  return res;
}

async function consume(res, { onText, onThinking, onActivity, onNotice, onSources }) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let failure = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;

      let payload;
      try {
        payload = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }

      if (payload.text) onText?.(payload.text);
      if (payload.thinking) onThinking?.(payload.thinking);
      if (payload.activity) onActivity?.(payload.activity);
      if (payload.notice) onNotice?.(payload.notice);
      if (payload.sources) onSources?.(payload.sources);
      if (payload.error) failure = new Error(payload.error);
    }
  }

  // Errors can arrive after partial text; the caller keeps whatever streamed.
  if (failure) throw failure;
}

export async function streamChat(messages, options = {}) {
  const { settings, connectors, project, signal, ...handlers } = options;
  // `projectId` is what a signed-in request needs — the server reads the stored
  // row. `project` carries the instructions themselves for a signed-out one,
  // which has no row to read, exactly as `settings.instructions` already does.
  const res = await post(
    { messages, settings, connectors, projectId: project?.id || null, project },
    signal
  );
  await consume(res, handlers);
}

/* -------------------------------- routines -------------------------------- */

// Routines live entirely on the server: they run while nobody is here, so
// there's no browser-side half to fall back to.
async function routineFetch(path, options = {}) {
  try {
    const res = await fetch(`/api/routines${path}`, { ...options, headers: await headers() });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: body?.error || `That didn't work (${res.status}).` };
    return body || {};
  } catch (err) {
    return { error: `Couldn't reach Selflight: ${err.message}` };
  }
}

export const routineApi = {
  async list() {
    const body = await routineFetch("?runs=1");
    return body.error ? null : body;
  },
  create(routine) {
    return routineFetch("", { method: "POST", body: JSON.stringify(routine) });
  },
  update(id, fields) {
    return routineFetch(`?id=${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(fields)
    });
  },
  remove(id) {
    return routineFetch(`?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  run(id) {
    return routineFetch(`?id=${encodeURIComponent(id)}&action=run`, { method: "POST" });
  }
};

export async function streamBuild(messages, options = {}) {
  const { signal, ...handlers } = options;
  const res = await post({ messages, task: "build" }, signal);
  await consume(res, handlers);
}

// What the deployment's model can do. The interface asks once and stops
// offering whatever comes back false.
export async function capabilities() {
  try {
    const res = await fetch("/api/capabilities");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Begins signing into a service. Returns null on success — the browser is on
 * its way to the provider by then — or a message to show if it can't start.
 *
 * The redirect is deliberately not a plain link: the server has to know who is
 * asking before it hands out a state cookie, and a link carries no session.
 */
export async function connectService(provider) {
  try {
    const res = await fetch("/api/oauth?action=start", {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ provider })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.url) return data?.error || "Couldn't start that sign-in.";

    window.location.assign(data.url);
    return null;
  } catch {
    return "Couldn't reach the server to start that sign-in.";
  }
}

// Short and fixed rather than a free-text box: "what went wrong?" gets filled
// in by roughly nobody, and four buttons get pressed. Mirrors REASONS in
// api/feedback.js, which is what actually validates them.
export const REPORT_REASONS = {
  wrong: "Wrong",
  invented: "Made something up",
  unhelpful: "Didn't answer",
  refused: "Wouldn't help"
};

/**
 * Reports a reply that was wrong. Deliberately sends no reply text and no
 * question — only the shape of the turn, which is what makes a report
 * actionable without making it a transcript.
 *
 * Fails silently: someone taking the trouble to flag a bad answer should not
 * then be shown an error about the flag.
 */
export async function reportReply(reason, shape = {}) {
  try {
    await fetch("/api/feedback", {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ reason, ...shape })
    });
  } catch {
    // Nothing useful to say, and nothing the person could do about it.
  }
}

export async function generateTitle(messages) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ messages, task: "title" })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch {
    return null;
  }
}
