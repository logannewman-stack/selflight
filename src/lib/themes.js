// Every appearance option resolves to CSS variables or a data attribute, so
// changing one is a single style write rather than a re-render.

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
      muted: "122 116 106",
      soft: "168 161 150",
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
      muted: "108 116 130",
      soft: "158 166 179",
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
      muted: "112 121 114",
      soft: "160 168 159",
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
    swatch: ["#FFFFFF", "#000000", "#0B44C4"],
    vars: {
      page: "255 255 255",
      panel: "243 243 243",
      surface: "255 255 255",
      raised: "255 255 255",
      line: "26 26 26",
      ink: "0 0 0",
      muted: "56 56 56",
      soft: "84 84 84",
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
  const palette = override || resolvePalette(settings, prefersDark, themes);
  const root = document.documentElement;

  for (const [key, value] of Object.entries(palette.vars)) {
    root.style.setProperty(`--${key}`, value);
  }

  // A custom palette owns its accent outright; the accent picker only overrides
  // the built-ins, whose accent is a default rather than a decision.
  const accent = pick(ACCENTS, settings.accent);
  if (accent.rgb && !palette.custom) root.style.setProperty("--accent", accent.rgb);

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
