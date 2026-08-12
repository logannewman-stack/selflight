// Font catalogue. Only the three defaults ship in index.html; everything else
// is fetched the first time someone actually selects it, so a big library costs
// nothing until it's used.

const FALLBACK = {
  Sans: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  Reading: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  Serif: "ui-serif, Georgia, Cambria, serif",
  Mono: "ui-monospace, SFMono-Regular, Menlo, monospace"
};

function font(id, name, group, google, extra = {}) {
  return {
    id,
    name,
    group,
    google,
    stack: google ? `"${name}", ${FALLBACK[group]}` : FALLBACK[group],
    ...extra
  };
}

export const FONTS = [
  // Sans
  font("system", "System", "Sans", null, { note: "Whatever your OS uses" }),
  font("geist", "Geist", "Sans", "Geist:wght@300..700"),
  font("inter-tight", "Inter Tight", "Sans", "Inter+Tight:wght@300..700"),
  font("instrument-sans", "Instrument Sans", "Sans", "Instrument+Sans:wght@400..700"),
  font("jakarta", "Plus Jakarta Sans", "Sans", "Plus+Jakarta+Sans:wght@300..700"),
  font("figtree", "Figtree", "Sans", "Figtree:wght@300..700"),
  font("dm-sans", "DM Sans", "Sans", "DM+Sans:opsz,wght@9..40,300..700"),
  font("manrope", "Manrope", "Sans", "Manrope:wght@300..700"),
  font("public-sans", "Public Sans", "Sans", "Public+Sans:wght@300..700"),
  font("outfit", "Outfit", "Sans", "Outfit:wght@300..700"),

  // Chosen for legibility research rather than fashion.
  font("atkinson", "Atkinson Hyperlegible", "Reading", "Atkinson+Hyperlegible:wght@400;700", {
    note: "Built for low vision — letters are hard to confuse"
  }),
  font("lexend", "Lexend", "Reading", "Lexend:wght@300..700", {
    note: "Shaped to reduce visual crowding while reading"
  }),

  // Serif
  font("source-serif", "Source Serif 4", "Serif", "Source+Serif+4:opsz,wght@8..60,400..600"),
  font("newsreader", "Newsreader", "Serif", "Newsreader:opsz,wght@6..72,400..600"),
  font("literata", "Literata", "Serif", "Literata:opsz,wght@7..72,400..600", {
    note: "Designed for long-form screen reading"
  }),
  font("lora", "Lora", "Serif", "Lora:wght@400..600"),
  font("spectral", "Spectral", "Serif", "Spectral:wght@400;500;600"),
  font("fraunces", "Fraunces", "Serif", "Fraunces:opsz,wght@9..144,300..700"),
  font("instrument-serif", "Instrument Serif", "Serif", "Instrument+Serif"),

  // Mono
  font("mono-system", "System Mono", "Mono", null),
  font("geist-mono", "Geist Mono", "Mono", "Geist+Mono:wght@400..600"),
  font("jetbrains", "JetBrains Mono", "Mono", "JetBrains+Mono:wght@400..600"),
  font("plex-mono", "IBM Plex Mono", "Mono", "IBM+Plex+Mono:wght@400;500;600"),
  font("fira-code", "Fira Code", "Mono", "Fira+Code:wght@400..600"),
  font("source-code", "Source Code Pro", "Mono", "Source+Code+Pro:wght@400..600"),
  font("space-mono", "Space Mono", "Mono", "Space+Mono:wght@400;700")
];

export const TEXT_FONTS = FONTS.filter((f) => f.group !== "Mono");
export const MONO_FONTS = FONTS.filter((f) => f.group === "Mono");

export function fontById(id, fallbackId) {
  return FONTS.find((f) => f.id === id) || FONTS.find((f) => f.id === fallbackId) || FONTS[0];
}

const requested = new Set();

export function loadFont(id) {
  const face = FONTS.find((f) => f.id === id);
  if (!face?.google || requested.has(id)) return;
  requested.add(id);

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${face.google}&display=swap`;
  document.head.appendChild(link);
}

export function loadFonts(ids) {
  for (const id of ids) loadFont(id);
}
