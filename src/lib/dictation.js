// Speaking instead of typing, using the browser's own speech recognition.
//
// No API key and no per-minute cost: the recognition runs through the browser,
// which is why this is worth doing before reaching for a paid transcription
// service. The trade is support — Chrome, Edge and Safari have it, Firefox
// doesn't — so `supported` is checked before the button is ever shown rather
// than presenting a control that does nothing.

const Recognition =
  typeof window !== "undefined" &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

// Browsers only hand out a microphone over HTTPS. localhost counts as secure,
// so this is only ever false on a plain-http address — typically a phone
// pointed at a laptop's IP on the same network.
//
// Worth checking separately rather than folding into `supported`, because the
// two failures need different explanations: "your browser can't" is permanent,
// "this address isn't secure" is a URL away from being fixed. Chrome makes this
// worse by leaving SpeechRecognition defined on insecure pages and only failing
// when you press the button.
export const secure = typeof window === "undefined" || window.isSecureContext !== false;

export const supported = Boolean(Recognition) && secure;

export const INSECURE_MESSAGE =
  "Dictation needs a secure (https) address. It works on your deployed site and on localhost, " +
  "but not over a plain http address like a local network IP.";

const MESSAGES = {
  "not-allowed": "Microphone access was blocked. Allow it in your browser's address bar and try again.",
  "service-not-allowed": "Your browser wouldn't start speech recognition. It may be off in settings.",
  "audio-capture": "No microphone found. Check one is plugged in and selected.",
  network: "Speech recognition needs a connection and couldn't reach it.",
  aborted: null, // Stopping on purpose isn't a failure.
  "no-speech": null // Silence isn't either.
};

/**
 * Starts dictating. Returns a handle with stop() — call it to finish early.
 *
 * onText receives ({ text, final }) as the person speaks: `final` marks a phrase
 * the engine has committed to, while everything before it is a live guess that
 * will be revised. The caller shows both, so words appear as they're said
 * rather than in a lump at the end.
 */
export function dictate({ lang, onText, onEnd, onError } = {}) {
  if (!supported) return null;

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  // The browser's language, unless told otherwise. Getting this wrong is the
  // difference between usable and useless for anyone not speaking US English.
  recognition.lang = lang || navigator.language || "en-US";

  let stopped = false;

  recognition.onresult = (event) => {
    let settled = "";
    let pending = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) settled += result[0].transcript;
      else pending += result[0].transcript;
    }

    if (settled) onText?.({ text: settled, final: true });
    if (pending) onText?.({ text: pending, final: false });
  };

  recognition.onerror = (event) => {
    const message = MESSAGES[event.error];
    // An unmapped error still needs to stop the button spinning, so onEnd runs
    // either way — onError only fires when there's something worth reading.
    if (message) onError?.(message);
    else if (message === undefined) onError?.("Dictation stopped unexpectedly.");
  };

  // Chrome ends the session on its own after a pause. Restarting keeps a long
  // thought from being cut in half, until stop() is actually called.
  recognition.onend = () => {
    if (stopped) return onEnd?.();
    try {
      recognition.start();
    } catch {
      onEnd?.();
    }
  };

  try {
    recognition.start();
  } catch (err) {
    onError?.("Couldn't start the microphone.");
    return null;
  }

  return {
    stop() {
      stopped = true;
      recognition.stop();
    }
  };
}

/* --------------------------- the other half ----------------------------- */

// Firefox has no speech recognition at all, and some browsers only offer it
// behind a flag. There, the microphone is recorded and the audio sent to
// /api/transcribe — slower, because nothing appears until you stop talking, but
// it means dictation isn't a Chrome-only feature.

// getUserMedia isn't even defined on an insecure page, so this is already
// false there — `secure` is what lets the interface say *why*.
export const canRecord =
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof MediaRecorder !== "undefined";

// Whatever this browser will actually produce. Safari records mp4, everything
// else webm/opus; both are formats the transcription services accept.
function pickMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

// Recording has no natural end, and a microphone left on is both a privacy
// problem and a bill. Two minutes is longer than anyone dictates in one go.
const MAX_MS = 120_000;

/**
 * Records until stop() is called, then resolves the transcript.
 *
 * onState reports "recording" then "transcribing", because the gap between
 * pressing stop and seeing words is long enough to need explaining.
 */
export async function record({ onState, authHeader } = {}) {
  if (!canRecord) throw new Error("This browser can't record audio.");

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw new Error(
      err?.name === "NotAllowedError"
        ? "Microphone access was blocked. Allow it in your browser's address bar and try again."
        : "No microphone found. Check one is plugged in and selected."
    );
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];

  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  recorder.start();
  onState?.("recording");

  const finished = new Promise((resolve) => (recorder.onstop = resolve));
  const timer = setTimeout(() => recorder.state !== "inactive" && recorder.stop(), MAX_MS);

  const done = (async () => {
    await finished;
    clearTimeout(timer);
    // Releasing the tracks is what turns off the browser's recording indicator.
    // Skipping it leaves a light on with nothing behind it.
    stream.getTracks().forEach((track) => track.stop());

    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    if (blob.size < 1200) return ""; // Too short to be speech.

    onState?.("transcribing");

    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type, ...(authHeader ? { Authorization: authHeader } : {}) },
      body: blob
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || "Couldn't transcribe that.");
    return data?.text || "";
  })();

  return {
    stop() {
      if (recorder.state !== "inactive") recorder.stop();
      return done;
    },
    cancel() {
      clearTimeout(timer);
      chunks.length = 0;
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
    }
  };
}
