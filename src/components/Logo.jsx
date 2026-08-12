import React from "react";

// A ring with a swash through it.
//
// Both strokes are `currentColor` rather than fixed, so the mark takes the
// colour of whatever it sits in — the sidebar, a dark sign-in screen, or a
// palette somebody tinted themselves. The swash is set slightly heavier than
// the ring: equal weights read as a slash, and the difference is what keeps it
// a mark at small sizes.
const RING = { r: 10.9, width: 1.9 };
const SWASH = { d: "M19.9 10.3C19.9 15.6 12.3 16.5 12.3 21.8", width: 2.4 };

export function Mark({ size = 24, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="Selflight"
      fill="none"
      stroke="currentColor"
    >
      <circle cx="16" cy="16" r={RING.r} strokeWidth={RING.width} />
      <path d={SWASH.d} strokeWidth={SWASH.width} strokeLinecap="round" />
    </svg>
  );
}

// The mark plus the name, both in the palette's ink. The mark is monochrome by
// design, so it stays the text colour rather than picking up the accent —
// swap `text-ink` for `text-accent` below if you'd rather it carried the colour.
export default function Logo({ size = 24, className = "", markClassName = "" }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <Mark size={size} className={`shrink-0 text-ink ${markClassName}`} />
      <span
        className="font-serif font-medium tracking-[-0.012em]"
        style={{ fontSize: `${Math.round(size * 0.86)}px` }}
      >
        Selflight
      </span>
    </span>
  );
}
