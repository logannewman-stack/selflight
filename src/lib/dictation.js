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

export const supported = Boolean(Recognition);

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
