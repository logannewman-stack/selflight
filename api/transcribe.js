// Speech to text for the browsers that can't do it themselves.
//
// Chrome, Edge and Safari have built-in speech recognition and it's free, so
// they never reach this. Firefox has none, and that's most of who this is for:
// the browser records audio, posts the bytes here, and gets words back.
//
// Any OpenAI-compatible transcription endpoint works. Whisper on OpenAI is
// about $0.006 a minute; Groq's is a fraction of that. Set TRANSCRIBE_BASE_URL
// to switch.

import { hasSupabase, recordUsage, usageThisMonth, userFromRequest } from "./_supabase.js";

export const config = {
  maxDuration: 60,
  // Audio, not JSON — let the raw bytes through untouched.
  api: { bodyParser: false }
};

const BASE_URL = process.env.TRANSCRIBE_BASE_URL || "https://api.openai.com/v1";
const MODEL = process.env.TRANSCRIBE_MODEL || "whisper-1";

// Vercel caps a function's request body around 4.5MB. Opus at dictation quality
// is roughly 3KB a second, so this is minutes of speech, not seconds — and it
// fails with a sentence rather than a stack trace.
const MAX_BYTES = 4_000_000;

export const configured = () => Boolean(process.env.TRANSCRIBE_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
  if (!configured()) {
    return json(res, 501, { error: "Server-side dictation isn't set up on this deployment." });
  }

  // Transcription costs money like everything else here, so it's behind the
  // same door as the model.
  let user = null;
  if (hasSupabase) {
    user = await userFromRequest(req);
    if (!user) return json(res, 401, { error: "Your session expired. Sign in again." });

    const usage = await usageThisMonth(user.id);
    if (usage.exceeded) return json(res, 429, { error: "You've used this month's allowance." });
  }

  let audio;
  try {
    audio = await readBody(req);
  } catch (err) {
    if (err.tooLarge) return json(res, 413, { error: "That recording is too long. Try a shorter one." });
    return json(res, 400, { error: "Couldn't read the recording." });
  }

  if (!audio.length) return json(res, 400, { error: "The recording was empty." });

  const type = String(req.headers["content-type"] || "audio/webm").split(";")[0];

  try {
    const form = new FormData();
    // The extension is what the upstream service uses to pick a decoder, so it
    // has to match what the browser actually recorded.
    form.append("file", new Blob([audio], { type }), `speech.${extensionFor(type)}`);
    form.append("model", MODEL);
    // Left to the service to detect: hard-coding English would quietly fail for
    // anyone who isn't speaking it.
    form.append("response_format", "json");

    const upstream = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.TRANSCRIBE_API_KEY}` },
      body: form
    });

    if (!upstream.ok) {
      const detail = await upstream.json().catch(() => null);
      console.error(`[api/transcribe] ${upstream.status}: ${detail?.error?.message || ""}`);
      return json(res, 502, { error: describe(upstream.status, detail) });
    }

    const { text } = await upstream.json();

    if (user) {
      // Audio isn't tokens. Recorded as its own kind so a minute of speech never
      // looks like a long conversation in the usage table.
      await recordUsage(user.id, {
        kind: "transcribe",
        model: MODEL,
        input: Math.round(audio.length / 1000)
      });
    }

    return json(res, 200, { text: (text || "").trim() });
  } catch (err) {
    console.error(`[api/transcribe] ${err?.stack || err}`);
    return json(res, 502, { error: "Couldn't transcribe that. Try again." });
  }
}

function describe(status, detail) {
  if (status === 401 || status === 403) return "The transcription key was rejected.";
  if (status === 429) return "Transcription is rate limited. Wait a moment.";
  return detail?.error?.message || "The transcription service refused that recording.";
}

function extensionFor(type) {
  if (type.includes("mp4") || type.includes("m4a")) return "mp4";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  if (type.includes("mpeg")) return "mp3";
  return "webm";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        const err = new Error("too large");
        err.tooLarge = true;
        req.destroy();
        return reject(err);
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
