// User-authored colour packages: create, edit, save, share. A package is just a
// named set of the same variables the built-in palettes use, so anything the
// editor produces is a first-class theme rather than a second-class override.

const KEY = "selflight.palettes.v1";
const ENVELOPE = "selflight.palette";

// Only these are exposed in the editor. Shadows come from the base palette —
// they're structural rather than expressive, and hand-editing them is a good
// way to make an interface look broken.
export const TOKEN_GROUPS = [
  {
    title: "Surfaces",
    tokens: [
      ["page", "Page"],
      ["panel", "Sidebar"],
      ["surface", "Cards and inputs"],
      ["raised", "Raised surfaces"],
      ["line", "Borders"]
    ]
  },
  {
    title: "Text",
    tokens: [
      ["ink", "Primary"],
      ["muted", "Secondary"],
      ["soft", "Tertiary"]
    ]
  },
  { title: "Accent", tokens: [["accent", "Accent"]] },
  {
    title: "Your messages",
    tokens: [
      ["bubble", "Bubble"],
      ["bubbleInk", "Bubble text"]
    ]
  },
  {
    title: "Code",
    tokens: [
      ["code", "Background"],
      ["syn-key", "Keyword"],
      ["syn-str", "String"],
      ["syn-com", "Comment"],
      ["syn-num", "Number"],
      ["syn-fn", "Function"],
      ["syn-attr", "Property"]
    ]
  }
];

const EDITABLE = TOKEN_GROUPS.flatMap((g) => g.tokens.map(([token]) => token));

/* ----------------------------- colour maths ---------------------------- */

export function parseTriplet(value) {
  const parts = String(value || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : [0, 0, 0];
}

export function tripletToHex(value) {
  const [r, g, b] = parseTriplet(value);
  const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function hexToTriplet(hex) {
  const clean = String(hex || "").replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}` : "0 0 0";
}

function luminance(triplet) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseTriplet(triplet);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG contrast ratio, so the editor can warn before someone saves a palette
// they can't actually read.
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function isDarkPalette(vars) {
  return luminance(vars.page) < 0.25;
}

/* ------------------------------- storage ------------------------------- */

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked or full — the session keeps working in memory.
  }
}

export function listPalettes() {
  return read();
}

export function savePalette(palette) {
  const stored = read();
  const index = stored.findIndex((p) => p.id === palette.id);
  const next = { ...palette, custom: true, dark: isDarkPalette(palette.vars) };

  if (index === -1) stored.push(next);
  else stored[index] = next;

  write(stored);
  return next;
}

export function deletePalette(id) {
  write(read().filter((p) => p.id !== id));
}

/* ------------------------------- authoring ----------------------------- */

export function draftFrom(base, name) {
  return {
    id: `pal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name || `${base.name} copy`,
    custom: true,
    dark: base.dark,
    // Carry the whole variable set so shadows and anything not exposed in the
    // editor still come along.
    vars: { ...base.vars },
    swatch: [...base.swatch]
  };
}

// The swatch shown in the palette list should reflect what was actually edited.
export function refreshSwatch(palette) {
  return {
    ...palette,
    swatch: [tripletToHex(palette.vars.page), tripletToHex(palette.vars.ink), tripletToHex(palette.vars.accent)]
  };
}

/* ---------------------------- share as a file -------------------------- */

export function exportPalette(palette) {
  return JSON.stringify(
    {
      [ENVELOPE]: 1,
      name: palette.name,
      vars: Object.fromEntries(EDITABLE.filter((t) => palette.vars[t]).map((t) => [t, palette.vars[t]]))
    },
    null,
    2
  );
}

// Accepts an exported package, or a bare { token: "r g b" } map, so a palette
// pasted from anywhere reasonable still imports.
export function importPalette(text, base) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON.");
  }

  const source = parsed?.vars && typeof parsed.vars === "object" ? parsed.vars : parsed;
  if (!source || typeof source !== "object") throw new Error("No colours found in there.");

  const vars = {};
  for (const token of EDITABLE) {
    const value = source[token];
    if (typeof value !== "string") continue;
    vars[token] = /^#|^[0-9a-f]{3,6}$/i.test(value.trim()) ? hexToTriplet(value) : value.trim();
  }

  const count = Object.keys(vars).length;
  if (count < 4) throw new Error(`Only found ${count} colours — that doesn't look like a palette.`);

  const draft = draftFrom(base, typeof parsed?.name === "string" ? parsed.name : "Imported palette");
  draft.vars = { ...draft.vars, ...vars };
  return refreshSwatch({ ...draft, dark: isDarkPalette(draft.vars) });
}
