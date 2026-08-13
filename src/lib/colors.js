// Colour names, so "make the background tan" means something.
//
// The CSS named colours are the list here because they're the one set of names
// people already share with their browser, their designer, and every other tool
// they use. `tan` is in it, and so are the 147 others.
//
// Lookup ignores spaces, hyphens and the grey/gray split, which is what makes
// "dark slate blue", "darkslateblue" and "dark-slate-grey" the same request.

const CSS = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4",
  azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000",
  blanchedalmond: "#ffebcd", blue: "#0000ff", blueviolet: "#8a2be2", brown: "#a52a2a",
  burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e",
  coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9", darkgreen: "#006400", darkkhaki: "#bdb76b", darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f", darkorange: "#ff8c00", darkorchid: "#9932cc", darkred: "#8b0000",
  darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3",
  deeppink: "#ff1493", deepskyblue: "#00bfff", dimgray: "#696969", dodgerblue: "#1e90ff",
  firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22", fuchsia: "#ff00ff",
  gainsboro: "#dcdcdc", ghostwhite: "#f8f8ff", gold: "#ffd700", goldenrod: "#daa520",
  gray: "#808080", green: "#008000", greenyellow: "#adff2f", honeydew: "#f0fff0",
  hotpink: "#ff69b4", indianred: "#cd5c5c", indigo: "#4b0082", ivory: "#fffff0",
  khaki: "#f0e68c", lavender: "#e6e6fa", lavenderblush: "#fff0f5", lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd", lightblue: "#add8e6", lightcoral: "#f08080", lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3", lightgreen: "#90ee90",
  lightpink: "#ffb6c1", lightsalmon: "#ffa07a", lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa", lightslategray: "#778899", lightsteelblue: "#b0c4de",
  lightyellow: "#ffffe0", lime: "#00ff00", limegreen: "#32cd32", linen: "#faf0e6",
  magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa", mediumblue: "#0000cd",
  mediumorchid: "#ba55d3", mediumpurple: "#9370db", mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585", midnightblue: "#191970", mintcream: "#f5fffa",
  mistyrose: "#ffe4e1", moccasin: "#ffe4b5", navajowhite: "#ffdead", navy: "#000080",
  oldlace: "#fdf5e6", olive: "#808000", olivedrab: "#6b8e23", orange: "#ffa500",
  orangered: "#ff4500", orchid: "#da70d6", palegoldenrod: "#eee8aa", palegreen: "#98fb98",
  paleturquoise: "#afeeee", palevioletred: "#db7093", papayawhip: "#ffefd5",
  peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb", plum: "#dda0dd",
  powderblue: "#b0e0e6", purple: "#800080", rebeccapurple: "#663399", red: "#ff0000",
  rosybrown: "#bc8f8f", royalblue: "#4169e1", saddlebrown: "#8b4513", salmon: "#fa8072",
  sandybrown: "#f4a460", seagreen: "#2e8b57", seashell: "#fff5ee", sienna: "#a0522d",
  silver: "#c0c0c0", skyblue: "#87ceeb", slateblue: "#6a5acd", slategray: "#708090",
  snow: "#fffafa", springgreen: "#00ff7f", steelblue: "#4682b4", tan: "#d2b48c",
  teal: "#008080", thistle: "#d8bfd8", tomato: "#ff6347", turquoise: "#40e0d0",
  violet: "#ee82ee", wheat: "#f5deb3", white: "#ffffff", whitesmoke: "#f5f5f5",
  yellow: "#ffff00", yellowgreen: "#9acd32"
};

// Names people say that CSS never adopted. Every one of these is a colour
// somebody has actually asked an interface for.
const EXTRA = {
  cream: "#f5efdf", offwhite: "#f4f1ea", eggshell: "#f0ead6", bone: "#e3ded3",
  parchment: "#efe6d3", sand: "#e3d5b8", oat: "#e8dfcd", clay: "#b66a50",
  terracotta: "#c96f4a", rust: "#b95830", brick: "#9c4a35", burgundy: "#6d232f",
  wine: "#722f3a", oxblood: "#5a1f22", blush: "#f3d9d5", dustyrose: "#c98d8d",
  peach: "#f7c9a8", apricot: "#f4b183", mustard: "#c9a227", ochre: "#cc7722",
  honey: "#dda63a", butter: "#f5e6a3", sage: "#9caa8b", moss: "#6a7d4f",
  fern: "#5a7861", eucalyptus: "#7f9e8d", pine: "#2f4c3c", hunter: "#33553f",
  seafoam: "#b3ded0", mint: "#b8e2cd", slate: "#5a6673", charcoal: "#33363b",
  graphite: "#3d4046", gunmetal: "#2b3038", steel: "#6b7a8c", denim: "#3f5c86",
  cobalt: "#1f4fa8", sapphire: "#1c3f94", periwinkle: "#a3aee0", lilac: "#c4a7dd",
  mauve: "#b08aa6", plumpurple: "#6b3f68", aubergine: "#4a2a45", espresso: "#3a2b25",
  coffee: "#5a4436", mocha: "#7a5e4c", taupe: "#8c7f70", greige: "#bdb5a7",
  warmgray: "#8c857b", coolgray: "#84898f", pewter: "#8f9296", ink: "#14161a",
  midnight: "#1b1b1f", nightblue: "#141a2b", jetblack: "#0a0a0b"
};

// grey/gray both spellings, for every name that has one.
const GREY = {};
for (const [name, hex] of Object.entries({ ...CSS, ...EXTRA })) {
  if (name.includes("gray")) GREY[name.replace(/gray/g, "grey")] = hex;
}

export const COLORS = { ...CSS, ...EXTRA, ...GREY };

// The longest name wins so "light sea green" doesn't resolve to "green", and
// "dark blue" doesn't resolve to "blue".
const MAX_WORDS = 3;

function key(words) {
  return words.join("").replace(/[^a-z]/g, "");
}

export function isColorName(text) {
  return Boolean(COLORS[key(String(text).toLowerCase().split(/\s+/))]);
}

/**
 * Finds a colour anywhere in a phrase and returns { hex, name, at, length },
 * where `at`/`length` locate it in the word array so a caller can tell "tan
 * background" from "background tan" — or strip it out and keep the rest.
 *
 * A hex code wins over a name, because typing one is unambiguous.
 */
export function findColor(text) {
  const words = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);

  // Only with the #. A bare "b95830" is far more often an id, a commit, or a
  // number someone read aloud than a colour.
  const hexAt = words.findIndex((w) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(w));
  if (hexAt !== -1) {
    const hex = words[hexAt];
    return { hex: hex.length === 4 ? expand(hex) : hex, name: hex, at: hexAt, length: 1 };
  }

  for (let size = MAX_WORDS; size >= 1; size--) {
    for (let at = 0; at + size <= words.length; at++) {
      const slice = words.slice(at, at + size);
      const hex = COLORS[key(slice)];
      if (hex) return { hex, name: slice.join(" "), at, length: size };
    }
  }
  return null;
}

function expand(hex) {
  const [, r, g, b] = /^#(.)(.)(.)$/.exec(hex);
  return `#${r}${r}${g}${g}${b}${b}`;
}
