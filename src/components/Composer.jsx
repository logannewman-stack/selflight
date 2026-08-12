import React, { useEffect, useRef } from "react";
import { ArrowUp, Globe, Link2, Square } from "lucide-react";

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  settings,
  connectorCount,
  focusSignal
}) {
  const ref = useRef(null);

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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mx-auto w-full max-w-[760px]">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface px-3.5 py-2.5 shadow-[0_1px_3px_rgb(0_0_0/0.04)] focus-within:border-soft">
          <textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={keyDown}
            placeholder="Message Selflight…"
            className="no-scrollbar max-h-[200px] flex-1 resize-none bg-transparent py-1 leading-relaxed outline-none placeholder:text-soft"
            style={{ fontSize: "var(--msg-size)" }}
          />

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
              onClick={onSend}
              disabled={!value.trim()}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bubble transition-transform active:scale-90 disabled:opacity-25"
            >
              <ArrowUp className="h-4 w-4 text-bubbleInk" strokeWidth={2.5} />
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center justify-center gap-3 text-xs text-soft">
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
        </div>
      </div>
    </div>
  );
}
