// Every appearance option resolves to CSS variables or a data attribute, so
// changing one is a single style write rather than a re-render.

import { hexToTriplet, tintFrom } from "./palettes.js";

const LIGHT_SHADOWS = {
  "shadow-sm": "0 1px 2px rgba(24, 22, 18, 0.05)",
  "shadow-md": "0 2px 8px rgba(24, 22, 18, 0.06), 0 1px 2px rgba(24, 22, 18, 0.04)",
  "shadow-lg": "0 16px 40px rgba(24, 22, 18, 0.11), 0 2px 8px rgba(24, 22, 18, 0.05)"
};

const DARK_SHADOWS = {
  "shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.4)",
  "shadow-md": "0 2px 10px rgba(0, 0, 0, 0.45), 0 1px 2px rgba(0, 0, 0, 0.3)",
  "shadow-lg": "0 20px 48px rgba(0, 0, 0, 0.6), 0 4px 12px rgba(0, 0, 0, 0.4)"
};

// Code colouring is per-palette so a light theme never gets a dark code block
// bolted onto it — the usual giveaway of a themed app that wasn't finished.
const LIGHT_SYNTAX = {
  "syn-key": "163 54 92",
  "syn-str": "50 108 72",
  "syn-com": "150 143 132",
  "syn-num": "164 92 28",
  "syn-fn": "56 88 158",
  "syn-attr": "18 112 118"
};

const DARK_SYNTAX = {
  "syn-key": "236 133 168",
  "syn-str": "140 200 150",
  "syn-com": "120 118 114",
  "syn-num": "230 176 110",
  "syn-fn": "142 176 236",
  "syn-attr": "112 202 206"
};

// Secondary and hint text in the three light palettes was measured after the
// fact and came in at 4.0–4.5:1 and 2.2–2.5:1 against their backgrounds — under
// the WCAG floors of 4.5 and 3. The `muted` corrections are two or three units
// and invisible; the `soft` ones are darker enough to notice, which is the
// point: at 2.5:1 a placeholder is decoration, not text. themes.test.mjs
// measures every palette against both backgrounds it sits on — the page and
// the sidebar panel — because the first pass only checked the page and left
// the sidebar's date headings a hair under the floor.
export const BUILT_IN_THEMES = [
  {
    id: "paper",
    name: "Paper",
    note: "Warm and low-glare. Easiest for long sessions.",
    dark: false,
    swatch: ["#FCFBF9", "#1C1B19", "#B95830"],
    vars: {
      page: "252 251 249",
      panel: "246 244 240",
      surface: "255 255 255",
      raised: "255 255 255",
      line: "232 228 220",
      ink: "28 27 25",
      muted: "115 110 100",
      soft: "145 139 130",
      accent: "185 88 48",
      bubble: "28 27 25",
      bubbleInk: "252 251 249",
      code: "245 242 236",
      ...LIGHT_SHADOWS,
      ...LIGHT_SYNTAX
    }
  },
  {
    id: "slate",
    name: "Slate",
    note: "Cool and neutral. Keeps colour out of the way of your work.",
    dark: false,
    swatch: ["#F8F9FB", "#15171C", "#2C68B4"],
    vars: {
      page: "248 249 251",
      panel: "240 242 246",
      surface: "255 255 255",
      raised: "255 255 255",
      line: "224 227 234",
      ink: "21 23 28",
      muted: "103 110 124",
      soft: "132 139 150",
      accent: "44 104 180",
      bubble: "21 23 28",
      bubbleInk: "248 249 251",
      code: "240 243 248",
      ...LIGHT_SHADOWS,
      ...LIGHT_SYNTAX
    }
  },
  {
    id: "focus",
    name: "Focus",
    note: "Low stimulation. Muted contrast and one quiet accent, for when bright screens are too much.",
    dark: false,
    swatch: ["#F2F3F0", "#2B302C", "#5A7861"],
    vars: {
      page: "242 243 240",
      panel: "236 238 234",
      surface: "249 250 248",
      raised: "252 252 251",
      line: "220 224 217",
      ink: "43 48 44",
      muted: "101 109 103",
      soft: "130 137 129",
      accent: "90 120 97",
      bubble: "43 48 44",
      bubbleInk: "244 246 243",
      code: "233 236 231",
      ...LIGHT_SHADOWS,
      // Desaturated so code doesn't become the loudest thing on a calm screen.
      "syn-key": "122 88 108",
      "syn-str": "80 112 92",
      "syn-com": "154 160 152",
      "syn-num": "140 112 76",
      "syn-fn": "84 104 138",
      "syn-attr": "72 116 116"
    }
  },
  {
    id: "midnight",
    name: "Midnight",
    note: "Dark with softened contrast. Kinder than pure black at night.",
    dark: true,
    swatch: ["#1B1B1F", "#EDECE9", "#DE8A63"],
    vars: {
      page: "27 27 31",
      panel: "33 33 38",
      surface: "38 38 44",
      raised: "45 45 52",
      line: "56 56 64",
      ink: "237 236 233",
      muted: "156 153 148",
      soft: "114 112 108",
      accent: "222 138 99",
      bubble: "237 236 233",
      bubbleInk: "27 27 31",
      code: "23 23 27",
      ...DARK_SHADOWS,
      ...DARK_SYNTAX
    }
  },
  {
    id: "nocturne",
    name: "Nocturne",
    note: "Near-black. Saves power on OLED and disappears in a dark room.",
    dark: true,
    swatch: ["#0A0A0B", "#E9E9E7", "#84AACC"],
    vars: {
      page: "10 10 11",
      panel: "17 17 19",
      surface: "22 22 25",
      raised: "28 28 32",
      line: "39 39 44",
      ink: "233 233 231",
      muted: "146 146 143",
      soft: "102 102 101",
      accent: "132 170 204",
      bubble: "233 233 231",
      bubbleInk: "10 10 11",
      code: "16 16 18",
      ...DARK_SHADOWS,
      ...DARK_SYNTAX
    }
  },
  {
    id: "contrast",
    name: "High contrast",
    note: "Maximum separation between text and background, for low vision or bright rooms.",
    dark: false,
    // These values are the palette, not a starting position. A main colour used
    // to re-tint them and the accent picker used to replace the accent, which
    // dropped body text from 21:1 to about 4.5:1 and secondary text below the
    // AA floor entirely — while the card still said "High contrast ✓". A
    // palette chosen for legibility has to be the one thing nothing else can
    // quietly override. See applyTheme.
    fixed: true,
    swatch: ["#FFFFFF", "#000000", "#0B44C4"],
    vars: {
      page: "255 255 255",
      panel: "243 243 243",
      surface: "255 255 255",
      raised: "255 255 255",
      line: "26 26 26",
      ink: "0 0 0",
      muted: "56 56 56",
      soft: "82 82 82",
      accent: "11 68 196",
      bubble: "0 0 0",
      bubbleInk: "255 255 255",
      code: "241 241 241",
      "shadow-sm": "0 0 0 1px rgba(0, 0, 0, 0.9)",
      "shadow-md": "0 0 0 1px rgba(0, 0, 0, 0.9)",
      "shadow-lg": "0 0 0 2px rgba(0, 0, 0, 0.9)",
      "syn-key": "150 0 60",
      "syn-str": "0 92 40",
      "syn-com": "84 84 84",
      "syn-num": "150 68 0",
      "syn-fn": "11 68 196",
      "syn-attr": "0 96 104"
    }
  },
  {
    id: "contrast-dark",
    name: "High contrast dark",
    note: "The same separation, inverted. For low vision in a dark room, and the dark half of the pair.",
    dark: true,
    // Without this there was no high-contrast option in dark mode at all, and
    // "Match system" had nothing to put in the dark slot — so turning it on
    // dropped anyone relying on high contrast back to a soft palette overnight.
    fixed: true,
    swatch: ["#000000", "#FFFFFF", "#7FC4FF"],
    vars: {
      page: "0 0 0",
      panel: "18 18 18",
      surface: "0 0 0",
      raised: "26 26 26",
      line: "224 224 224",
      ink: "255 255 255",
      muted: "216 216 216",
      soft: "178 178 178",
      accent: "127 196 255",
      bubble: "255 255 255",
      bubbleInk: "0 0 0",
      code: "20 20 20",
      // A ring rather than a blur: a soft shadow is invisible against black,
      // which is how a "raised" surface stops looking raised.
      "shadow-sm": "0 0 0 1px rgba(255, 255, 255, 0.9)",
      "shadow-md": "0 0 0 1px rgba(255, 255, 255, 0.9)",
      "shadow-lg": "0 0 0 2px rgba(255, 255, 255, 0.9)",
      "syn-key": "255 158 190",
      "syn-str": "142 226 158",
      "syn-com": "178 178 178",
      "syn-num": "255 190 118",
      "syn-fn": "127 196 255",
      "syn-attr": "126 224 228"
    }
  }
];

// Overrides the palette's own accent when set to anything but "palette".
export const ACCENTS = [
  { id: "palette", name: "Palette", rgb: null },
  { id: "rust", name: "Rust", rgb: "185 88 48" },
  { id: "amber", name: "Amber", rgb: "173 114 26" },
  { id: "olive", name: "Olive", rgb: "104 124 62" },
  { id: "teal", name: "Teal", rgb: "22 122 122" },
  { id: "blue", name: "Blue", rgb: "44 104 180" },
  { id: "indigo", name: "Indigo", rgb: "94 94 200" },
  { id: "violet", name: "Violet", rgb: "138 82 180" },
  { id: "rose", name: "Rose", rgb: "190 70 110" }
];

export const TEXT_SIZES = [
  { id: "sm", name: "Small", value: "14px" },
  { id: "md", name: "Medium", value: "15.5px" },
  { id: "lg", name: "Large", value: "17px" },
  { id: "xl", name: "Extra large", value: "19px" }
];

export const LINE_SPACINGS = [
  { id: "tight", name: "Tight", value: "1.5" },
  { id: "normal", name: "Normal", value: "1.68" },
  { id: "relaxed", name: "Relaxed", value: "1.9" }
];

export const CODE_SIZES = [
  { id: "sm", name: "Small", value: "0.78em" },
  { id: "md", name: "Medium", value: "0.86em" },
  { id: "lg", name: "Large", value: "0.96em" }
];

export const WEIGHTS = [
  { id: "light", name: "Light", value: "350" },
  { id: "regular", name: "Regular", value: "400" },
  { id: "book", name: "Book", value: "450" },
  { id: "medium", name: "Medium", value: "500" }
];

// Extra letter-spacing measurably helps some dyslexic readers, so this goes
// wider than a designer would normally allow.
export const TRACKINGS = [
  { id: "tight", name: "Tight", value: "-0.011em" },
  { id: "normal", name: "Normal", value: "0em" },
  { id: "wide", name: "Wide", value: "0.02em" },
  { id: "wider", name: "Wider", value: "0.045em" }
];

export const HEADING_SCALES = [
  { id: "flat", name: "Flat", vars: { h1: "1.06em", h2: "1em", h3: "0.95em" } },
  { id: "normal", name: "Normal", vars: { h1: "1.22em", h2: "1.1em", h3: "1em" } },
  { id: "loud", name: "Loud", vars: { h1: "1.5em", h2: "1.28em", h3: "1.1em" } }
];

export const PARA_SPACINGS = [
  { id: "tight", name: "Tight", value: "0.7em" },
  { id: "normal", name: "Normal", value: "1em" },
  { id: "loose", name: "Loose", value: "1.4em" }
];

export const DENSITIES = [
  { id: "compact", name: "Compact", vars: { "gap-msg": "1.1rem", "row-y": "5px", "pad-y": "1.1rem" } },
  {
    id: "comfortable",
    name: "Comfortable",
    vars: { "gap-msg": "1.6rem", "row-y": "7px", "pad-y": "1.5rem" }
  },
  { id: "spacious", name: "Spacious", vars: { "gap-msg": "2.4rem", "row-y": "9px", "pad-y": "2.25rem" } }
];

export const WIDTHS = [
  { id: "narrow", name: "Narrow", value: "640px" },
  { id: "medium", name: "Medium", value: "760px" },
  { id: "wide", name: "Wide", value: "920px" },
  { id: "full", name: "Full", value: "100%" }
];

export const CORNERS = [
  { id: "square", name: "Square", vars: { "r-lg": "4px", "r-xl": "6px", "r-2xl": "9px", "r-3xl": "12px" } },
  { id: "soft", name: "Soft", vars: { "r-lg": "10px", "r-xl": "13px", "r-2xl": "17px", "r-3xl": "22px" } },
  { id: "round", name: "Round", vars: { "r-lg": "14px", "r-xl": "18px", "r-2xl": "24px", "r-3xl": "30px" } }
];

export const BUBBLE_STYLES = [
  { id: "bubble", name: "Bubble" },
  { id: "plain", name: "Plain" }
];

export const SEND_KEYS = [
  { id: "enter", name: "Enter", hint: "Shift+Enter for a new line" },
  { id: "mod", name: "⌘+Enter", hint: "Enter makes a new line" }
];

function pick(list, id) {
  return list.find((item) => item.id === id) || list[0];
}

export function accentFor(settings = {}) {
  if (settings.accent === "custom") {
    return settings.accentCustom ? hexToTriplet(settings.accentCustom) : null;
  }
  return pick(ACCENTS, settings.accent).rgb;
}

// Rebuilds a palette around a chosen background colour. Surfaces and text are
// derived; shadows and syntax colours come from the light or dark set, because
// they're structural and a tinted app still needs code to be readable.
function tinted(palette, baseColor) {
  if (!baseColor) return palette;
  // A fixed palette is exempt. Tinting derives every surface and text colour
  // from one background, which is the right behaviour for a palette chosen for
  // its look and exactly the wrong one for a palette chosen because it can be
  // read — the derivation lands around 4.5:1 wherever it starts.
  if (palette.fixed) return palette;

  const { dark, vars } = tintFrom(baseColor);
  return {
    ...palette,
    dark,
    vars: {
      ...palette.vars,
      ...vars,
      ...(dark ? DARK_SHADOWS : LIGHT_SHADOWS),
      // Only when the tint flips the palette's own mode — otherwise a palette's
      // hand-tuned syntax colours survive being re-tinted.
      ...(dark === palette.dark ? {} : dark ? DARK_SYNTAX : LIGHT_SYNTAX)
    }
  };
}

// When "match system" is on, the palette follows the OS instead of the manual
// pick, using whichever light/dark pair was chosen last.
export function resolveThemeId(settings, prefersDark) {
  if (!settings.matchSystem) return settings.theme;
  return prefersDark ? settings.darkTheme : settings.lightTheme;
}

export function resolvePalette(settings, prefersDark, themes = BUILT_IN_THEMES) {
  const id = resolveThemeId(settings, prefersDark);
  return themes.find((t) => t.id === id) || themes[0] || BUILT_IN_THEMES[0];
}

// `override` lets the palette editor preview an unsaved draft without saving it
// or touching the stored settings.
export function applyTheme(settings, { prefersDark = false, themes, override } = {}) {
  const chosen = override || resolvePalette(settings, prefersDark, themes);
  // A base colour re-tints the whole app from one pick. It layers over whatever
  // palette is selected rather than replacing it, so the parts it doesn't
  // define — syntax colours, shadows — still come from somewhere considered.
  const palette = override ? chosen : tinted(chosen, settings.baseColor);
  const root = document.documentElement;

  for (const [key, value] of Object.entries(palette.vars)) {
    root.style.setProperty(`--${key}`, value);
  }

  // A custom palette owns its accent outright; the accent picker only overrides
  // the built-ins, whose accent is a default rather than a decision. A colour
  // picked by hand always wins — it can't be anything but deliberate.
  //
  // A fixed palette owns its accent too. Sky blue on white is 2.4:1, which is
  // fine as taste and unreadable as an accent, and the palette it was applied
  // to was the one picked precisely so things could be read.
  const accent = accentFor(settings);
  if (accent && !palette.fixed && (!palette.custom || settings.accent === "custom")) {
    root.style.setProperty("--accent", accent);
  }

  for (const group of [
    pick(DENSITIES, settings.density),
    pick(CORNERS, settings.corners),
    pick(HEADING_SCALES, settings.headingScale)
  ]) {
    for (const [key, value] of Object.entries(group.vars)) {
      root.style.setProperty(`--${key}`, value);
    }
  }

  root.style.setProperty("--msg-size", pick(TEXT_SIZES, settings.textSize).value);
  root.style.setProperty("--leading-msg", pick(LINE_SPACINGS, settings.lineSpacing).value);
  root.style.setProperty("--code-size", pick(CODE_SIZES, settings.codeSize).value);
  root.style.setProperty("--thread-max", pick(WIDTHS, settings.width).value);
  root.style.setProperty("--weight-body", pick(WEIGHTS, settings.bodyWeight).value);
  root.style.setProperty("--tracking-body", pick(TRACKINGS, settings.tracking).value);
  root.style.setProperty("--para-gap", pick(PARA_SPACINGS, settings.paraSpacing).value);

  root.dataset.mode = palette.dark ? "dark" : "light";
  root.dataset.motion = settings.reduceMotion ? "reduced" : "full";
  root.dataset.codeWrap = settings.codeWrap ? "on" : "off";
  // Native controls (scrollbars, form widgets) follow the palette too.
  root.style.colorScheme = palette.dark ? "dark" : "light";

  // Mobile browser chrome matches the app instead of banding against it.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", `rgb(${palette.vars.page.split(" ").join(", ")})`);
}

// Fonts are applied separately because they need the catalogue, and the
// catalogue fetches a face the first time it's actually used.
export function applyFonts({ uiFont, replyFont, codeFont }, catalogue) {
  const root = document.documentElement;
  root.style.setProperty("--font-sans", catalogue.fontById(uiFont, "geist").stack);
  root.style.setProperty("--font-reading", catalogue.fontById(replyFont, "geist").stack);
  root.style.setProperty("--font-mono", catalogue.fontById(codeFont, "geist-mono").stack);
  catalogue.loadFonts([uiFont, replyFont, codeFont]);
}
