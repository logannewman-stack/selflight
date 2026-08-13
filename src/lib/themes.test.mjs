// Can you actually read it?
//
//   node --test src/lib/themes.test.mjs
//
// Every palette is measured against WCAG rather than eyeballed, because the way
// this broke was silent: "Main colour" re-tinted the High contrast palette and
// dropped body text from 21:1 to 4.5:1 with the card still showing it selected
// and ticked. Nothing looked wrong on screen unless you already knew.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_THEMES } from "./themes.js";
import { contrast, tintFrom } from "./palettes.js";

// WCAG 2.1. AA is 4.5:1 for body text and 3:1 for large text and UI edges; AAA
// is 7:1. "High contrast" has to clear AAA or the name is a lie.
const AA = 4.5;
const AAA = 7;
const AA_LARGE = 3;

const named = (id) => BUILT_IN_THEMES.find((t) => t.id === id);

// Against both backgrounds text actually sits on, not just the page. The first
// version of this file measured against `page` alone, passed, and the browser
// suite then found the sidebar's date headings at 2.98:1 — they're `text-soft`
// on `bg-panel`, and panel is the darker of the two in every light palette.
const worst = (colour, vars) => Math.min(contrast(colour, vars.page), contrast(colour, vars.panel));

const ratios = (vars) => ({
  body: worst(vars.ink, vars),
  secondary: worst(vars.muted, vars),
  soft: worst(vars.soft, vars),
  accent: worst(vars.accent, vars),
  bubble: contrast(vars.bubbleInk, vars.bubble),
  code: contrast(vars.ink, vars.code)
});

/* --------------------------- every palette at all ------------------------- */

for (const theme of BUILT_IN_THEMES) {
  test(`${theme.name} is legible`, () => {
    const r = ratios(theme.vars);

    assert.ok(r.body >= AA, `body text is ${r.body.toFixed(2)}:1, needs ${AA}`);
    assert.ok(r.secondary >= AA, `secondary text is ${r.secondary.toFixed(2)}:1, needs ${AA}`);
    // `soft` is date headings, hints and placeholders — small, but still words
    // somebody has to read.
    assert.ok(r.soft >= AA_LARGE, `the softest text is ${r.soft.toFixed(2)}:1, needs ${AA_LARGE}`);
    assert.ok(r.accent >= AA_LARGE, `the accent is ${r.accent.toFixed(2)}:1, needs ${AA_LARGE}`);
    // Your own messages sit on a filled bubble, which is its own background.
    assert.ok(r.bubble >= AA, `text on your messages is ${r.bubble.toFixed(2)}:1, needs ${AA}`);
    assert.ok(r.code >= AA, `code is ${r.code.toFixed(2)}:1, needs ${AA}`);
  });
}

test("every palette declares whether it is dark, and means it", () => {
  for (const theme of BUILT_IN_THEMES) {
    const light = contrast(theme.vars.page, "0 0 0") > 10.5;
    assert.equal(
      theme.dark,
      !light,
      `${theme.name} says dark: ${theme.dark}, but its page is ${light ? "light" : "dark"}`
    );
  }
});

test("swatches match the palette they advertise", () => {
  // A swatch that doesn't match its palette is a lie in the one place someone
  // looks before clicking.
  for (const theme of BUILT_IN_THEMES) {
    assert.equal(theme.swatch.length, 3, `${theme.name} should show page, ink and accent`);
    const hex = (t) =>
      "#" + t.split(/\s+/).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    assert.equal(theme.swatch[0].toLowerCase(), hex(theme.vars.page), `${theme.name} page swatch`);
    assert.equal(theme.swatch[1].toLowerCase(), hex(theme.vars.ink), `${theme.name} ink swatch`);
    assert.equal(theme.swatch[2].toLowerCase(), hex(theme.vars.accent), `${theme.name} accent swatch`);
  }
});

/* ---------------------------- the high contrast ones ---------------------- */

test("High contrast clears AAA, not just AA", () => {
  const r = ratios(named("contrast").vars);
  assert.ok(r.body >= AAA, `body text is ${r.body.toFixed(2)}:1 — that isn't high contrast`);
  assert.ok(r.secondary >= AAA, `secondary text is ${r.secondary.toFixed(2)}:1`);
  assert.ok(r.soft >= AAA, `the softest text is ${r.soft.toFixed(2)}:1`);
  assert.ok(r.accent >= AA, `the accent is ${r.accent.toFixed(2)}:1`);
});

test("High contrast dark clears AAA too", () => {
  const r = ratios(named("contrast-dark").vars);
  assert.ok(r.body >= AAA, `body text is ${r.body.toFixed(2)}:1`);
  assert.ok(r.secondary >= AAA, `secondary text is ${r.secondary.toFixed(2)}:1`);
  assert.ok(r.soft >= AAA, `the softest text is ${r.soft.toFixed(2)}:1`);
  assert.ok(r.accent >= AA, `the accent is ${r.accent.toFixed(2)}:1`);
});

test("there is a high contrast palette for both light and dark", () => {
  // Without the dark one, turning on "Match system" had nothing to put in the
  // dark slot and silently dropped anyone relying on this to a soft palette.
  assert.equal(named("contrast").dark, false);
  assert.equal(named("contrast-dark").dark, true);
});

test("the high contrast palettes are marked fixed", () => {
  assert.equal(named("contrast").fixed, true);
  assert.equal(named("contrast-dark").fixed, true);
});

test("no other built-in claims to be fixed", () => {
  // `fixed` exempts a palette from recolouring. Setting it on a decorative
  // palette would take away a control for no reason.
  const fixed = BUILT_IN_THEMES.filter((t) => t.fixed).map((t) => t.id);
  assert.deepEqual(fixed, ["contrast", "contrast-dark"]);
});

/* ------------------- what recolouring would have done to it ---------------- */

test("tinting a normal palette is what wrecked contrast, and still would", () => {
  // Not a complaint about the tint — it's doing what it says. This test exists
  // to show the number the exemption is protecting against, so if `tintFrom`
  // ever gets contrast-aware this test fails and the exemption can be revisited.
  const worst = ["#3B6EA5", "#B95830", "#5A7861", "#7A4FA3"].map((base) => {
    const { vars } = tintFrom(base);
    return contrast(vars.muted, vars.page);
  });

  assert.ok(
    Math.min(...worst) < AA,
    "tinting now clears AA on its own — the fixed-palette exemption may no longer be needed"
  );
});
