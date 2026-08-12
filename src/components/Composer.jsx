import React, { useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";

export default function Composer({ value, onChange, onSend, onStop, streaming }) {
  const ref = useRef(null);

  // Grow with the text, then scroll instead of pushing the thread off screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const keyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="mx-auto w-full max-w-[720px]">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-white px-3.5 py-2.5 shadow-[0_1px_3px_rgba(26,26,26,0.04)] focus-within:border-soft">
          <textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={keyDown}
            placeholder="Message Selflight…"
            className="no-scrollbar max-h-[200px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-relaxed outline-none placeholder:text-soft"
          />

          {streaming ? (
            <button
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink transition-transform active:scale-90"
            >
              <Square className="h-3 w-3 fill-white text-white" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!value.trim()}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink transition-transform active:scale-90 disabled:opacity-25"
            >
              <ArrowUp className="h-4 w-4 text-white" strokeWidth={2.5} />
            </button>
          )}
        </div>

        <p className="mt-2 text-center text-[11px] text-soft">
          Selflight can be wrong. Check anything that matters.
        </p>
      </div>
    </div>
  );
}
