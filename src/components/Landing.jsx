import React, { useEffect, useState } from "react";
import Logo from "./Logo.jsx";

// The first thing anybody sees at polstar.ai.
//
// One claim, made plainly, and a way in. Not a feature grid: somebody who has
// just typed the address in has decided nothing yet, and a wall of bullet
// points is a decision they haven't asked to make. The one sentence that
// matters is the one about being told the truth, because that is the whole
// argument for using this rather than any of the others.
//
// The whole page is the button. Tap, click, press a key — all of it continues.
// A "Get started" button somewhere specific is a target to find; this is a door
// you fall through.

const LINES = [
  "It says when it doesn't know.",
  "It shows what it read.",
  "It tells you when it was wrong."
];

export default function Landing({ onContinue }) {
  const [leaving, setLeaving] = useState(false);

  const go = () => {
    if (leaving) return;
    // Somebody who has turned motion off is asking not to wait for a fade.
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) return onContinue();
    setLeaving(true);
    // Long enough to see the page acknowledge the tap, short enough that it
    // never feels like waiting.
    setTimeout(onContinue, 240);
  };

  // Anything at all continues. Keyboard included, because a page that only
  // responds to a mouse is a page some people cannot leave. Tab is left alone
  // so the focus ring can still be reached, and a bare modifier isn't a press.
  useEffect(() => {
    const key = (e) => {
      if (e.key === "Tab" || e.key === "Shift" || e.key === "Control") return;
      if (e.key === "Alt" || e.key === "Meta") return;
      go();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [leaving]);

  return (
    // `onClick` rather than `onTouchStart`: a touch that turns into a scroll
    // fires touchstart but never a click, so this way a short screen can be
    // read to the bottom without the page leaving out from under the reader.
    <div
      onClick={go}
      role="button"
      tabIndex={0}
      aria-label="Continue to sign in"
      className={`relative flex h-full w-full cursor-pointer select-none flex-col overflow-y-auto bg-page transition-opacity duration-200 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)"
      }}
    >
      {/* A single soft light behind the mark. The only decoration on the page,
          and it moves nothing — no parallax, no float, nothing that makes a
          reader wait for the layout to settle before they can read it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[46rem] w-[46rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07]"
        style={{
          background: "radial-gradient(circle, rgb(var(--accent)) 0%, transparent 62%)"
        }}
      />

      {/* Tighter on a phone by 32px, which is what it took to fit the whole
          pitch on a 390×844 screen without scrolling — measured at 849px in
          844, which is the sort of miss you only find by asking for a number. */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-6 text-center sm:py-10">
        <div className="rise">
          <Logo size={44} />
        </div>

        {/* `ch` scales with the type, so one number does both jobs: at 56px on
            a laptop it's wide enough for the sentence to stay on one line, and
            at 32px on a phone it's narrower than the screen and wraps. Balanced
            because the first draft broke after "the" and left "truth." alone on
            a line by itself, which reads like a mistake rather than a claim. */}
        <h1
          className="rise mt-7 max-w-[34ch] text-balance font-serif text-[clamp(2rem,7vw,3.5rem)] font-normal leading-[1.08] tracking-[-0.03em]"
          style={{ animationDelay: "60ms" }}
        >
          The AI that tells you the truth.
        </h1>

        <p
          className="rise mt-5 max-w-[46ch] text-balance text-[clamp(1rem,2.4vw,1.2rem)] leading-relaxed text-muted"
          style={{ animationDelay: "140ms" }}
        >
          Most assistants would rather sound certain than be right. Polstar is built the other way
          round — it would rather tell you it doesn't know.
        </p>

        {/* Stacked and left-aligned on a phone, so the three bullets line up in
            a column instead of scattering with the length of each sentence —
            centred text and a leading bullet is the one combination that always
            looks ragged. `w-fit` keeps the block itself centred. */}
        <ul
          className="rise mt-7 flex w-fit flex-col items-start gap-2.5 text-left text-md text-muted sm:mt-8 sm:w-auto sm:flex-row sm:gap-7 sm:text-center"
          style={{ animationDelay: "220ms" }}
        >
          {LINES.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-accent" />
              {line}
            </li>
          ))}
        </ul>
      </div>

      {/* Low on the screen, where a thumb already is. On a phone this sits just
          above the home indicator; on a laptop it reads as a footer. Either
          way it's a hint rather than a control, because the control is the
          whole page — which is also why it has to be legible. The first draft
          set it in `text-soft/70`, about 2.3:1 on a light palette: the one
          instruction on the page, printed in the colour reserved for
          placeholders. `muted` is the dimmest thing that still clears 4.5:1
          in every palette. */}
      <div
        className="rise relative shrink-0 pb-8 pt-4 text-center sm:pb-12"
        style={{ animationDelay: "320ms" }}
      >
        <p className="text-md font-medium text-muted">
          <span className="hidden sm:inline">Click anywhere to continue</span>
          <span className="sm:hidden">Tap anywhere to continue</span>
        </p>
        {/* Also `muted`, not `soft`: at 11.5px uppercase it measured 3.2:1 on
            three of the palettes, and the hierarchy here comes from size and
            tracking rather than from making the second line harder to read. */}
        <p className="mt-1.5 text-xs uppercase tracking-[0.14em] text-muted">
          Sign in · Create an account
        </p>

        <span
          aria-hidden
          className="mx-auto mt-4 block h-6 w-px bg-gradient-to-b from-transparent to-soft/50"
        />
      </div>
    </div>
  );
}
