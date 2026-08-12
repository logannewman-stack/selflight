// Palettes are plain RGB triplets so Tailwind can drive them through CSS
// variables — switching a theme repaints the whole app with no re-render.

export const THEMES = [
  {
    id: "paper",
    name: "Paper",
    note: "Warm and low-glare. Easiest for long sessions.",
    dark: false,
    swatch: ["#FAF9F7", "#1A1A1A", "#B4552F"],
    vars: {
      page: "250 249 247",
      panel: "243 241 236",
      surface: "255 255 255",
      line: "230 226 217",
      ink: "26 26 26",
      muted: "128 121 110",
      soft: "173 166 154",
      accent: "180 85 47",
      bubble: "26 26 26",
      bubbleInk: "255 255 255",
      code: "241 237 229"
    }
  },
  {
    id: "slate",
    name: "Slate",
    note: "Cool and neutral. Keeps colour out of the way of your work.",
    dark: false,
    swatch: ["#F7F8FA", "#16181D", "#2F6BB4"],
    vars: {
      page: "247 248 250",
      panel: "239 241 245",
      surface: "255 255 255",
      line: "223 226 233",
      ink: "22 24 29",
      muted: "110 118 132",
      soft: "160 167 180",
      accent: "47 107 180",
      bubble: "22 24 29",
      bubbleInk: "255 255 255",
      code: "237 240 245"
    }
  },
  {
    id: "focus",
    name: "Focus",
    note: "Low stimulation. Muted contrast and one quiet accent, for when bright screens are too much.",
    dark: false,
    swatch: ["#F2F3F0", "#2B302C", "#5F7A63"],
    vars: {
      page: "242 243 240",
      panel: "235 237 233",
      surface: "250 251 249",
      line: "219 223 216",
      ink: "43 48 44",
      muted: "116 124 117",
      soft: "163 170 162",
      accent: "95 122 99",
      bubble: "43 48 44",
      bubbleInk: "245 247 244",
      code: "232 235 230"
    }
  },
  {
    id: "midnight",
    name: "Midnight",
    note: "Dark with softened contrast. Kinder than pure black at night.",
    dark: true,
    swatch: ["#1B1B1F", "#EDECE9", "#D9845F"],
    vars: {
      page: "27 27 31",
      panel: "34 34 39",
      surface: "38 38 44",
      line: "56 56 63",
      ink: "237 236 233",
      muted: "154 151 146",
      soft: "112 110 106",
      accent: "217 132 95",
      bubble: "237 236 233",
      bubbleInk: "27 27 31",
      code: "44 44 50"
    }
  },
  {
    id: "nocturne",
    name: "Nocturne",
    note: "Near-black. Saves power on OLED and disappears in a dark room.",
    dark: true,
    swatch: ["#0A0A0B", "#E8E8E6", "#7FA6C9"],
    vars: {
      page: "10 10 11",
      panel: "17 17 19",
      surface: "21 21 24",
      line: "38 38 42",
      ink: "232 232 230",
      muted: "143 143 140",
      soft: "100 100 99",
      accent: "127 166 201",
      bubble: "232 232 230",
      bubbleInk: "10 10 11",
      code: "24 24 27"
    }
  },
  {
    id: "contrast",
    name: "High contrast",
    note: "Maximum separation between text and background, for low vision or bright rooms.",
    dark: false,
    swatch: ["#FFFFFF", "#000000", "#0B4FD1"],
    vars: {
      page: "255 255 255",
      panel: "244 244 244",
      surface: "255 255 255",
      line: "24 24 24",
      ink: "0 0 0",
      muted: "60 60 60",
      soft: "90 90 90",
      accent: "11 79 209",
      bubble: "0 0 0",
      bubbleInk: "255 255 255",
      code: "240 240 240"
    }
  }
];

export const TEXT_SIZES = [
  { id: "sm", name: "Small", msg: "14px" },
  { id: "md", name: "Medium", msg: "15px" },
  { id: "lg", name: "Large", msg: "17px" },
  { id: "xl", name: "Extra large", msg: "19px" }
];

export function applyTheme({ theme, textSize, reduceMotion }) {
  const palette = THEMES.find((t) => t.id === theme) || THEMES[0];
  const size = TEXT_SIZES.find((s) => s.id === textSize) || TEXT_SIZES[1];
  const root = document.documentElement;

  for (const [key, value] of Object.entries(palette.vars)) {
    root.style.setProperty(`--${key}`, value);
  }
  root.style.setProperty("--msg-size", size.msg);
  root.dataset.mode = palette.dark ? "dark" : "light";
  root.dataset.motion = reduceMotion ? "reduced" : "full";
  // Native controls (scrollbars, form widgets) follow the palette too.
  root.style.colorScheme = palette.dark ? "dark" : "light";
}
