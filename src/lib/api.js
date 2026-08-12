// Talks to /api/chat. The model is never called from the browser — the API key
// stays on the server, which is what makes this safe to deploy publicly.

const ENDPOINT = "/api/chat";

async function post(payload, signal) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });

  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error || "Couldn't reach Selflight. Try again.");
  }
  return res;
}

async function consume(res, { onText, onActivity, onNotice }) {
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
      if (payload.activity) onActivity?.(payload.activity);
      if (payload.notice) onNotice?.(payload.notice);
      if (payload.error) failure = new Error(payload.error);
    }
  }

  // Errors can arrive after partial text; the caller keeps whatever streamed.
  if (failure) throw failure;
}

export async function streamChat(messages, options = {}) {
  const { settings, connectors, signal, ...handlers } = options;
  const res = await post({ messages, settings, connectors }, signal);
  await consume(res, handlers);
}

export async function streamBuild(messages, options = {}) {
  const { signal, ...handlers } = options;
  const res = await post({ messages, task: "build" }, signal);
  await consume(res, handlers);
}

export async function generateTitle(messages) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, task: "title" })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch {
    return null;
  }
}
