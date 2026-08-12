// Palettes are plain CSS variable values so Tailwind can drive them — switching
// a theme is one style write rather than a re-render. Colour tokens are RGB
// triplets (so Tailwind's `/ <alpha-value>` works); shadows are whole strings.

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

export const THEMES = [
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
      accentSoft: "185 88 48",
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
      accentSoft: "44 104 180",
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
      accentSoft: "90 120 97",
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
      accentSoft: "222 138 99",
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
      accentSoft: "132 170 204",
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
      accentSoft: "11 68 196",
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

export const TEXT_SIZES = [
  { id: "sm", name: "Small", msg: "14px" },
  { id: "md", name: "Medium", msg: "15.5px" },
  { id: "lg", name: "Large", msg: "17px" },
  { id: "xl", name: "Extra large", msg: "19px" }
];

export const READING_FACES = [
  { id: "sans", name: "Sans", stack: "var(--font-sans)" },
  { id: "serif", name: "Serif", stack: "var(--font-serif)" }
];

export function applyTheme({ theme, textSize, readingFace, reduceMotion }) {
  const palette = THEMES.find((t) => t.id === theme) || THEMES[0];
  const size = TEXT_SIZES.find((s) => s.id === textSize) || TEXT_SIZES[1];
  const face = READING_FACES.find((f) => f.id === readingFace) || READING_FACES[0];
  const root = document.documentElement;

  for (const [key, value] of Object.entries(palette.vars)) {
    root.style.setProperty(`--${key}`, value);
  }
  root.style.setProperty("--msg-size", size.msg);
  root.style.setProperty("--font-reading", face.stack);
  root.dataset.mode = palette.dark ? "dark" : "light";
  root.dataset.motion = reduceMotion ? "reduced" : "full";
  // Native controls (scrollbars, form widgets) follow the palette too.
  root.style.colorScheme = palette.dark ? "dark" : "light";

  // Mobile browser chrome matches the app instead of banding against it.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", `rgb(${palette.vars.page.split(" ").join(", ")})`);
}
