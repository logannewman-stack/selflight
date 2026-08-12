import React from "react";

// A single small light you carry. It's the one mark that means the name rather
// than gesturing at it, and it's warm in the same way the default palette is.
//
// Drawn as one path with an evenodd hole rather than two stacked shapes, so the
// inner flame is genuinely transparent. That matters because the mark sits on
// the page, the sidebar, and a dark sign-in screen — a second shape would have
// to guess which of those it was on, and be wrong somewhere.
const FLAME =
  "M16 2.6c3.4 5.4 8 8.6 8 14.4a8 8 0 0 1-16 0c0-5.8 4.6-9 8-14.4Z" +
  "M16 14.6c1.5 2.4 3.5 3.8 3.5 6.3a3.5 3.5 0 0 1-7 0c0-2.5 2-3.9 3.5-6.3Z";

export function Mark({ size = 24, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="Selflight"
      fill="currentColor"
    >
      <path fillRule="evenodd" clipRule="evenodd" d={FLAME} />
    </svg>
  );
}

// The mark plus the name. `text-accent` on the mark and the palette's ink on the
// word, which is what keeps the lockup readable on every theme including one
// the person tinted themselves.
export default function Logo({ size = 24, className = "", markClassName = "" }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <Mark size={size} className={`shrink-0 text-accent ${markClassName}`} />
      <span
        className="font-serif font-medium tracking-[-0.012em]"
        style={{ fontSize: `${Math.round(size * 0.86)}px` }}
      >
        Selflight
      </span>
    </span>
  );
}
