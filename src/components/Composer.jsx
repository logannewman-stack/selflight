import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Globe, Link2, Loader2, Mic, Square } from "lucide-react";
import {
  INSECURE_MESSAGE,
  canRecord,
  dictate,
  record,
  secure,
  supported as canListen
} from "../lib/dictation.js";
import { accessToken } from "../lib/supabase.js";
import { EFFORTS, MODE, effortFor } from "../lib/brand.js";

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
  onSettings,
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
  // On a plain-http address neither path can work, but the reason is fixable —
  // so the button stays and explains itself rather than vanishing.
  const micAvailable = live || viaServer || !secure;

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
              onClick={
                secure ? (listening ? stopDictation : startDictation) : () => setMicError(INSECURE_MESSAGE)
              }
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

        {/* While dictating, this is the only feedback that the words are
            landing, so it takes the whole line rather than crowding the bar. */}
        {transcribing || listening ? (
          <p className="mt-2 text-center text-xs text-soft">
            {transcribing ? (
              <span className="text-muted">Writing that down…</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-accent">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                {viaServer
                  ? "Recording — press the microphone again when you're done"
                  : heard
                    ? "Listening…"
                    : "Listening — start speaking"}
              </span>
            )}
          </p>
        ) : (
          <div className="mt-2 flex items-center gap-2 text-xs text-soft">
            <button
              onClick={() => onSettings({ webSearch: !settings.webSearch })}
              title={settings.webSearch ? "Turn web search off" : "Turn web search on"}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 transition-colors ${
                settings.webSearch
                  ? "border-line text-muted hover:border-soft hover:text-ink"
                  : "border-transparent text-soft hover:text-muted"
              }`}
            >
              <Globe className="h-3 w-3" strokeWidth={2} />
              Web {settings.webSearch ? "on" : "off"}
            </button>

            {connectorCount > 0 && (
              <span className="flex shrink-0 items-center gap-1.5 text-soft">
                <Link2 className="h-3 w-3" strokeWidth={2} />
                {connectorCount}
              </span>
            )}

            {/* The caveat still belongs here, but it's the least important
                thing on the row now, so it yields first when space runs out. */}
            <span className="hidden min-w-0 flex-1 truncate px-2 text-center lg:block">
              Selflight can be wrong. Check anything that matters.
            </span>
            <span className="flex-1 lg:hidden" />

            <EffortPicker settings={settings} onSettings={onSettings} />
          </div>
        )}
      </div>
    </div>
  );
}

// The model and how hard it's working, at the edge of the composer where you
// can see it while typing and change it without leaving the conversation.
function EffortPicker({ settings, onSettings }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const current = effortFor(settings);

  // Any click outside, or Escape, closes it — a menu you can only dismiss by
  // choosing something is a trap.
  useEffect(() => {
    if (!open) return;
    const away = (e) => !wrap.current?.contains(e.target) && setOpen(false);
    const key = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Effort"
        className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-medium text-muted transition-colors hover:border-soft hover:text-ink"
      >
        <span>{MODE}</span>
        <span className="text-soft">{current.name}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.2} />
      </button>

      {open && (
        <div
          role="menu"
          className="rise absolute bottom-full right-0 z-20 mb-2 w-[17rem] overflow-hidden rounded-xl border border-line bg-raised shadow-lg"
        >
          <p className="border-b border-line px-3 py-2 text-2xs font-semibold uppercase tracking-[0.1em] text-soft">
            {MODE} · effort
          </p>

          {EFFORTS.map((effort) => {
            const active = effort.id === current.id;
            return (
              <button
                key={effort.id}
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onSettings({ depth: effort.id });
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                  active ? "bg-panel" : "hover:bg-panel/60"
                }`}
              >
                <Check
                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${active ? "text-accent" : "opacity-0"}`}
                  strokeWidth={2.6}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-base font-medium text-ink">{effort.name}</span>
                    {/* The number that makes this a real choice rather than a
                        vague "more is better". */}
                    <span className="shrink-0 text-2xs text-soft">{effort.cost}</span>
                  </span>
                  <span className="mt-0.5 block text-sm leading-snug text-muted">{effort.note}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
