import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, Globe, Link2, Loader2, Mic, Square } from "lucide-react";
import { canRecord, dictate, record, supported as canListen } from "../lib/dictation.js";
import { accessToken } from "../lib/supabase.js";

// Speech arrives without leading spaces, so appending it to typed text needs
// one adding — but not after an open bracket or a newline, and not before
// punctuation the engine occasionally emits on its own.
function join(base, addition) {
  const spoken = addition.trim();
  if (!spoken) return base;
  if (!base) return spoken.charAt(0).toUpperCase() + spoken.slice(1);
  if (/[\s([{"'‘“]$/.test(base) || /^[,.!?;:]/.test(spoken)) return base + spoken;
  return `${base} ${spoken}`;
}

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  settings,
  connectorCount,
  canTranscribe,
  focusSignal
}) {
  const ref = useRef(null);

  // Two ways to dictate. The browser's own recognition is free and shows words
  // as they're said, so it wins wherever it exists. Recording and sending the
  // audio is the fallback that makes this work in Firefox at all.
  const live = canListen;
  const viaServer = !live && canRecord && canTranscribe;
  const micAvailable = live || viaServer;

  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [heard, setHeard] = useState("");
  const [micError, setMicError] = useState(null);
  const sessionRef = useRef(null);
  // What was already typed when dictation started, so speech is appended to it
  // rather than replacing a half-written message.
  const baseRef = useRef("");

  const stopDictation = async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setListening(false);
    setHeard("");
    if (!session) return;

    // The live path is done the moment it stops. The recording path has to send
    // the audio somewhere and wait, so the button keeps a state to show for it.
    const result = session.stop();
    if (!result?.then) return;

    try {
      const text = await result;
      if (text) onChange(join(baseRef.current, text));
    } catch (err) {
      setMicError(err.message);
    } finally {
      setTranscribing(false);
    }
  };

  const startRecording = async () => {
    setMicError(null);
    baseRef.current = value;

    try {
      const token = await accessToken();
      const session = await record({
        authHeader: token ? `Bearer ${token}` : null,
        onState: (state) => setTranscribing(state === "transcribing")
      });
      sessionRef.current = session;
      setListening(true);
    } catch (err) {
      setMicError(err.message);
    }
  };

  const startDictation = () => {
    if (viaServer) return startRecording();

    setMicError(null);
    baseRef.current = value;

    const session = dictate({
      onText: ({ text, final }) => {
        if (final) {
          // Committed words join the message; the live guess resets so it isn't
          // counted twice.
          baseRef.current = join(baseRef.current, text);
          setHeard("");
          onChange(baseRef.current);
        } else {
          setHeard(text);
          onChange(join(baseRef.current, text));
        }
      },
      onError: (message) => {
        setMicError(message);
        stopDictation();
      },
      onEnd: () => {
        sessionRef.current = null;
        setListening(false);
        setHeard("");
      }
    });

    if (!session) return;
    sessionRef.current = session;
    setListening(true);
  };

  // A dictation left running after the composer goes away would keep the
  // microphone open with nothing to show for it. cancel() where it exists, so a
  // recording being abandoned doesn't also pay to transcribe itself.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      session?.cancel ? session.cancel() : session?.stop();
    },
    []
  );

  // Sending finishes the thought; the mic shouldn't stay on for the next one.
  const send = () => {
    if (listening) stopDictation();
    onSend();
  };

  // Grow with the text, then scroll instead of pushing the thread off screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  // Focus on desktop when a chat opens. Skipped on touch layouts, where it
  // would throw up the keyboard over the conversation you just opened.
  useEffect(() => {
    if (!focusSignal) return;
    if (window.matchMedia?.("(min-width: 768px)").matches) ref.current?.focus();
  }, [focusSignal]);

  const keyDown = (e) => {
    if (e.key !== "Enter") return;
    const mod = e.metaKey || e.ctrlKey;

    if (settings.sendKey === "mod") {
      if (mod) {
        e.preventDefault();
        send();
      }
      return;
    }

    if (!mod && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="thread-col">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface px-3.5 py-2.5 shadow-[0_1px_3px_rgb(0_0_0/0.04)] focus-within:border-soft">
          <textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={keyDown}
            placeholder={
              settings.sendKey === "mod" ? "Message Selflight… (⌘↵ to send)" : "Message Selflight…"
            }
            className="no-scrollbar max-h-[200px] flex-1 resize-none bg-transparent py-1 leading-relaxed outline-none placeholder:text-soft"
            style={{ fontSize: "var(--msg-size)" }}
          />

          {/* Hidden entirely where neither path is possible, rather than shown
              and then apologising. */}
          {micAvailable && !streaming && (
            <button
              onClick={listening ? stopDictation : startDictation}
              disabled={transcribing}
              aria-label={listening ? "Stop dictating" : "Dictate a message"}
              aria-pressed={listening}
              title={listening ? "Stop dictating" : "Dictate a message"}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                listening ? "bg-accent text-page" : "text-muted hover:bg-panel hover:text-ink"
              } disabled:opacity-40`}
            >
              {transcribing ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <Mic className={`h-4 w-4 ${listening ? "animate-pulse" : ""}`} strokeWidth={2} />
              )}
            </button>
          )}

          {streaming ? (
            <button
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bubble transition-transform active:scale-90"
            >
              <Square className="h-3 w-3 fill-bubbleInk text-bubbleInk" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!value.trim()}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bubble transition-transform active:scale-90 disabled:opacity-25"
            >
              <ArrowUp className="h-4 w-4 text-bubbleInk" strokeWidth={2.5} />
            </button>
          )}
        </div>

        {micError && (
          <p role="alert" className="mt-2 text-center text-sm text-accent">
            {micError}
          </p>
        )}

        <div className="mt-2 flex items-center justify-center gap-3 text-xs text-soft">
          {/* While dictating, this line is the only feedback that the words are
              landing — so it replaces the usual footer rather than crowding it. */}
          {transcribing ? (
            <span className="text-muted">Writing that down…</span>
          ) : listening ? (
            <span className="flex items-center gap-1.5 text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              {viaServer
                ? "Recording — press the microphone again when you're done"
                : heard
                  ? "Listening…"
                  : "Listening — start speaking"}
            </span>
          ) : (
            <>
              {settings.webSearch && (
                <span className="flex items-center gap-1">
                  <Globe className="h-3 w-3" strokeWidth={2} />
                  Web on
                </span>
              )}
              {connectorCount > 0 && (
                <span className="flex items-center gap-1">
                  <Link2 className="h-3 w-3" strokeWidth={2} />
                  {connectorCount} connector{connectorCount === 1 ? "" : "s"}
                </span>
              )}
              <span>Selflight can be wrong. Check anything that matters.</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
