// Saying what you want instead of finding the control for it.
//
// "make the background tan", "open settings", "bigger text", "be more direct" —
// typed into the composer or spoken through dictation, which arrives as the same
// text in the same box. Nothing here is voice-specific; the microphone just
// writes into the input, so anything you can type you can say.
//
// This runs locally rather than asking the model, for three reasons: it's
// instant, where a round trip is a second or two of watching nothing happen;
// it's free, where every parsed message would otherwise cost about 2.4¢; and
// it's deterministic, so "open settings" always opens settings.
//
// The cost of a local parser is that it only knows the phrasings it knows. The
// cost of getting it *wrong* is worse — swallowing a real question as a
// command — so the rules below never fire on a question, and the interface
// always offers to send the message after all. See runCommand in App.jsx.

import {
  ACCENTS,
  CODE_SIZES,
  CORNERS,
  DENSITIES,
  HEADING_SCALES,
  LINE_SPACINGS,
  PARA_SPACINGS,
  TEXT_SIZES,
  TRACKINGS,
  WEIGHTS,
  WIDTHS
} from "./themes.js";
import { FONTS } from "./fonts.js";
import { findColor } from "./colors.js";

/* ------------------------------ normalising ------------------------------ */

// Spoken input has no punctuation and plenty of throat-clearing, so both get
// removed before anything is matched. Written input loses nothing by it.
const LEAD =
  /^(?:hey|hi|hello|ok|okay|alright|so|well|um+|uh+|er+|please|selflight|iris|now|also|and|can you|could you|would you|will you|i want you to|i want|i'd like you to|i'd like|i would like|i need you to|i need|let'?s|go ahead and|just|maybe|actually)\b[\s,]*/;

// What's left after "I want …" is often "this app to be …", which no rule
// should have to know about.
const SUBJECT =
  /^(?:(?:the |this |that |your )?(?:app|interface|ui|page|screen|site|llm|bot|chat|thing|it|everything)\b[\s,]*)?(?:to be|to look|to go|be|look|go)?\b[\s,]*/;

const TRAIL = /[\s,]*(?:please|thanks|thank you|for me|if you can|if possible|now|ok|okay)\W*$/;

export function clean(text) {
  let s = String(text || "")
    .toLowerCase()
    .replace(/[""'']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");

  // Politeness stacks — "hey, ok, can you please…" is one phrase, not four.
  for (let i = 0; i < 6; i++) {
    const shorter = s.replace(LEAD, "");
    if (shorter === s) break;
    s = shorter;
  }

  s = s.replace(SUBJECT, "").replace(TRAIL, "").trim();
  return s;
}

// Questions are answered, never acted on. Checked against the raw text as well
// as the cleaned one, because stripping "can you" is exactly what would turn a
// question into an apparent instruction.
const ASKING =
  /^(?:what|whats|why|when|where|who|whose|which|how|is|are|was|were|does|do|did|should|could|would|will|can|may|explain|tell me|describe|define|show me how|remind me)\b/;

const ABOUT = /\b(?:to know|to learn|to understand|about how|the difference between|mean by|in css|in tailwind|in html|in javascript|hex code|colou?r code|stands for)\b/;

export function isQuestion(raw, cleaned) {
  if (/\?\s*$/.test(String(raw || "").trim())) return true;
  if (ABOUT.test(cleaned)) return true;
  return ASKING.test(cleaned);
}

// "Change the tone of this email to be more direct" is a real instruction — to
// the model, about a document. Every word the appearance rules look for is in
// it. What separates the two is what's being pointed at: a demonstrative in
// front of a piece of writing means the work, not the window it's shown in.
//
// `text` is deliberately absent: it belongs to the type controls far more often
// than it refers to a document, and "make this text bigger" should still work.
const REFERENT =
  /\b(?:this|that|these|those|my|his|her|their|the above|the following)\s+(?:e?mail|message|letter|paragraph|essay|draft|post|article|copy|sentence|document|doc|report|resume|cv|bio|caption|list|snippet|function|readme|note|story|script|pitch|proposal)\b/;

// Something has to be asked for. Without this, any sentence mentioning a colour
// would repaint the app.
//
// Tested against the original text as well as the cleaned one, because cleaning
// is what removes the ask: "I want this app to be tan" becomes "tan", and the
// evidence that it was a request goes with it.
const DIRECTIVE =
  /\b(?:make|set|change|switch|turn|use|give|put|apply|go|open|show|close|hide|reset|increase|decrease|raise|lower|bump|shrink|grow|enable|disable|start|stop|be|want|need|prefer|default)\b/;

/* -------------------------------- helpers -------------------------------- */

const ids = (list) => list.map((item) => item.id);

// One notch along an ordered scale, clamped at both ends.
function step(list, current, direction) {
  const order = ids(list);
  const at = order.indexOf(current);
  const next = Math.min(order.length - 1, Math.max(0, (at === -1 ? 1 : at) + direction));
  return order[next];
}

function label(list, id) {
  return (list.find((item) => item.id === id)?.name || id).toLowerCase();
}

// Matches "compact", "comfortable", "spacious" and so on straight off the
// option lists, so a new option in themes.js is speakable the day it lands.
function pickById(list, s, extras = {}) {
  for (const item of list) {
    const words = [item.id, item.name.toLowerCase(), ...(extras[item.id] || [])];
    for (const word of words) {
      if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(s)) return item.id;
    }
  }
  return null;
}

const bigger = /\b(?:bigger|larger|increase|raise|bump up|grow|up)\b/;
const smaller = /\b(?:smaller|tinier|decrease|lower|reduce|shrink|down)\b/;
const more = /\b(?:more|increase|wider|looser|taller)\b/;
const less = /\b(?:less|decrease|tighter|narrower|reduce)\b/;

const on = /\b(?:on|enable|enabled|turn on|use|yes|allow)\b/;
const off = /\b(?:off|disable|disabled|turn off|no|stop|don'?t|without|never)\b/;

/* --------------------------------- rules --------------------------------- */
//
// Each returns a command or null, and the first that returns wins — so the
// specific ones come before the general. `accent` before `background`, because
// "make the accent blue" also contains a colour and a directive.

// The palette in effect right now, if it's one that refuses to be recoloured.
//
// High contrast and its dark twin ignore a main colour and an accent, which is
// the whole point of them — but a typed instruction is explicit, and silently
// dropping it would leave "Background is tan." on screen with nothing changed.
// So the instruction wins and the consequence gets said out loud.
function fixedPalette(ctx) {
  const id = ctx.settings?.matchSystem
    ? ctx.prefersDark
      ? ctx.settings?.darkTheme
      : ctx.settings?.lightTheme
    : ctx.settings?.theme;

  const active = (ctx.themes || []).find((t) => t.id === id);
  if (!active?.fixed) return null;
  // Somewhere for the tint to land — it supplies the syntax colours and
  // shadows the tint doesn't derive.
  return { name: active.name, fallback: active.dark ? "midnight" : "paper" };
}

const RULES = [
  /* ---- getting around ---- */

  function newChat(s) {
    if (/\b(?:new|another|fresh|blank|clear|start a new)\b.*\b(?:chat|conversation|thread)\b/.test(s)) {
      return { act: "newChat", say: "Started a new chat." };
    }
    if (/^(?:start over|clear (?:this|the (?:chat|conversation))|reset the chat)$/.test(s)) {
      return { act: "newChat", say: "Started a new chat." };
    }
    return null;
  },

  function signOut(s) {
    return /\b(?:sign|log)\s*(?:me\s*)?out\b/.test(s)
      ? { act: "signOut", say: "Signed out." }
      : null;
  },

  function closePanel(s) {
    return /\b(?:close|hide|dismiss|get rid of)\b.*\b(?:settings|panel|appearance|sidebar|that|this|it)\b/.test(s)
      ? { act: "close", say: "Closed." }
      : null;
  },

  /* ---- colour ---- */

  function accent(s, ctx) {
    if (!/\b(?:accent|highlight|link colou?r|button colou?r)\b/.test(s)) return null;

    // Going back to the palette's own accent is already what a fixed palette
    // does, so that path needs none of the handling below.
    if (/\b(?:default|palette|reset|back|normal)\b/.test(s)) {
      return { patch: { accent: "palette" }, say: "Accent back to the palette's own." };
    }

    const fixed = fixedPalette(ctx);
    const leave = fixed ? { theme: fixed.fallback } : {};
    const note = fixed ? ` That turned off ${fixed.name}.` : "";

    const named = ACCENTS.find(
      (a) => a.rgb && new RegExp(`\\b${a.name.toLowerCase()}\\b`).test(s)
    );
    if (named) {
      return {
        patch: { accent: named.id, ...leave },
        say: `Accent is ${named.name.toLowerCase()}.${note}`
      };
    }

    const found = findColor(s);
    if (!found) return null;
    return {
      patch: { accent: "custom", accentCustom: found.hex, ...leave },
      say: `Accent is ${found.name}.${note}`
    };
  },

  function namedTheme(s, ctx) {
    if (!ctx.asked) return null;

    // Longest name first, or "High contrast" matches inside "High contrast
    // dark" and the dark one becomes unreachable by name.
    const byLength = [...(ctx.themes || [])].sort((a, b) => b.name.length - a.name.length);

    // User-made palettes are matched by name too, so "switch to my Ocean
    // palette" works the day after it's written.
    for (const theme of byLength) {
      const name = theme.name.toLowerCase();
      // One-word palette names need the word "theme" or "palette" nearby, or
      // any message containing "focus" would change the theme.
      const bare = name.split(/\s+/).length === 1;
      const near = new RegExp(`\\b${name}\\b${bare ? "(?=.*\\b(?:theme|palette|package)\\b)|\\b(?:theme|palette|package)\\b.*\\b" + name + "\\b" : ""}`);
      if (near.test(s)) {
        return {
          patch: { theme: theme.id, matchSystem: false },
          say: `Theme is ${theme.name}.`
        };
      }
    }
    return null;
  },

  function mode(s, ctx) {
    if (/\b(?:match|follow|use)\b.*\b(?:system|os|device|phone)\b/.test(s) || /\bsystem (?:theme|mode)\b/.test(s)) {
      return { patch: { matchSystem: true }, say: "Following your system's light and dark setting." };
    }

    const dark = /\b(?:dark|night|black)\s*(?:mode|theme)?\b/.test(s) && !/\bnot dark\b/.test(s);
    const light = /\b(?:light|day|bright)\s*(?:mode|theme)?\b/.test(s);
    if (!dark && !light) return null;
    // "dark blue background" is a colour, not a mode.
    if (findColor(s)?.name.includes(dark ? "dark" : "light")) return null;
    // Bare "dark mode" is an instruction; "the paper I read said dark mode
    // saves battery" is a sentence that happens to contain one. With no verb
    // asking for anything, only the short form counts.
    if (!ctx.asked && s.split(/\s+/).length > 3) return null;

    const wanted = dark ? ctx.settings?.darkTheme || "midnight" : ctx.settings?.lightTheme || "paper";
    return {
      patch: { theme: wanted, matchSystem: false, baseColor: "" },
      say: dark ? "Switched to dark." : "Switched to light."
    };
  },

  function background(s, ctx) {
    if (/\b(?:reset|default|back to normal|undo)\b/.test(s) && /\b(?:colou?rs?|theme|appearance|background)\b/.test(s)) {
      return {
        patch: { baseColor: "", accent: "palette" },
        say: "Colours are back to the palette's own."
      };
    }

    const found = findColor(s);
    if (!found || !ctx.asked) return null;

    // Something has to say this is about the app's colour rather than the
    // subject of a sentence that happens to mention one.
    const target =
      /\b(?:background|bg|colou?r|theme|palette|app|interface|ui|page|screen|everything|it)\b/.test(s);
    if (!target) return null;

    const fixed = fixedPalette(ctx);
    return {
      patch: {
        baseColor: found.hex,
        matchSystem: false,
        ...(fixed ? { theme: fixed.fallback } : {})
      },
      say: fixed
        ? `Background is ${found.name}. That turned off ${fixed.name}.`
        : `Background is ${found.name}.`
    };
  },

  /* ---- type ---- */

  function font(s, ctx) {
    if (!ctx.asked && !/\bfont|typeface\b/.test(s)) return null;

    const named = FONTS.find((f) => {
      const name = f.name.toLowerCase();
      // "System" and "Mono" are words before they're fonts.
      if (name === "system" || name === "system mono") return false;
      return new RegExp(`\\b${name.replace(/\+/g, "\\+")}\\b`).test(s);
    });

    if (named) {
      const patch =
        named.group === "Mono" ? { codeFont: named.id } : { uiFont: named.id, replyFont: named.id };
      return { patch, say: `Font is ${named.name}.` };
    }

    // Families, when no specific face was named.
    if (!/\b(?:font|typeface|type)\b/.test(s)) return null;
    if (/\bserif\b/.test(s) && !/\bsans[- ]?serif\b/.test(s)) {
      return { patch: { uiFont: "source-serif", replyFont: "source-serif" }, say: "Font is Source Serif." };
    }
    if (/\bsans\b/.test(s)) {
      return { patch: { uiFont: "geist", replyFont: "geist" }, say: "Font is Geist." };
    }
    if (/\bmono(?:space)?\b/.test(s)) {
      return { patch: { codeFont: "geist-mono" }, say: "Code font is Geist Mono." };
    }
    return null;
  },

  function textSize(s, ctx) {
    if (!/\b(?:text|font|type|words|letters)\b/.test(s) && !/\bsize\b/.test(s)) return null;
    if (/\b(?:code|spacing|line|weight|heading)\b/.test(s)) return null;

    const direct = pickById(TEXT_SIZES, s, { sm: ["tiny"], xl: ["huge", "extra big"] });
    if (direct && /\bsize\b/.test(s)) {
      return { patch: { textSize: direct }, say: `Text is ${label(TEXT_SIZES, direct)}.` };
    }

    const dir = bigger.test(s) ? 1 : smaller.test(s) ? -1 : 0;
    if (!dir) return direct ? { patch: { textSize: direct }, say: `Text is ${label(TEXT_SIZES, direct)}.` } : null;

    const next = step(TEXT_SIZES, ctx.settings?.textSize, dir);
    return { patch: { textSize: next }, say: `Text is ${label(TEXT_SIZES, next)}.` };
  },

  function codeSize(s, ctx) {
    if (!/\bcode\b/.test(s) || !/\b(?:size|bigger|smaller|larger)\b/.test(s)) return null;
    const dir = bigger.test(s) ? 1 : smaller.test(s) ? -1 : 0;
    const next = dir
      ? step(CODE_SIZES, ctx.settings?.codeSize, dir)
      : pickById(CODE_SIZES, s);
    return next ? { patch: { codeSize: next }, say: `Code is ${label(CODE_SIZES, next)}.` } : null;
  },

  function lineSpacing(s, ctx) {
    if (!/\b(?:line spacing|line height|leading|spacing between lines)\b/.test(s)) return null;
    const direct = pickById(LINE_SPACINGS, s, { relaxed: ["loose", "airy"] });
    if (direct) return { patch: { lineSpacing: direct }, say: `Line spacing is ${label(LINE_SPACINGS, direct)}.` };

    const dir = more.test(s) ? 1 : less.test(s) ? -1 : 0;
    if (!dir) return null;
    const next = step(LINE_SPACINGS, ctx.settings?.lineSpacing, dir);
    return { patch: { lineSpacing: next }, say: `Line spacing is ${label(LINE_SPACINGS, next)}.` };
  },

  function weight(s, ctx) {
    // "weight" alone belongs to the gym far more often than to typography, so
    // it only counts when something says which weight is meant.
    const typographic = /\b(?:text|font|type|letter)\s*weight\b/.test(s);
    if (!typographic && !/\b(?:bold|bolder|thinner|heavier)\b/.test(s)) return null;
    const dir = /\b(?:bold|bolder|heavier|thicker)\b/.test(s) ? 1 : -1;
    const next = step(WEIGHTS, ctx.settings?.bodyWeight, dir);
    return { patch: { bodyWeight: next }, say: `Text weight is ${label(WEIGHTS, next)}.` };
  },

  function tracking(s, ctx) {
    if (!/\b(?:letter spacing|tracking|space between letters)\b/.test(s)) return null;
    const direct = pickById(TRACKINGS, s);
    const next = direct || step(TRACKINGS, ctx.settings?.tracking, more.test(s) ? 1 : -1);
    return { patch: { tracking: next }, say: `Letter spacing is ${label(TRACKINGS, next)}.` };
  },

  function paragraphs(s, ctx) {
    if (!/\b(?:paragraph|para) (?:spacing|gap)\b/.test(s)) return null;
    const direct = pickById(PARA_SPACINGS, s);
    const next = direct || step(PARA_SPACINGS, ctx.settings?.paraSpacing, more.test(s) ? 1 : -1);
    return { patch: { paraSpacing: next }, say: `Paragraph spacing is ${label(PARA_SPACINGS, next)}.` };
  },

  function headings(s) {
    if (!/\bheadings?\b/.test(s)) return null;
    const direct = pickById(HEADING_SCALES, s, { loud: ["big", "bigger", "large"], flat: ["small", "quiet", "subtle"] });
    return direct ? { patch: { headingScale: direct }, say: `Headings are ${label(HEADING_SCALES, direct)}.` } : null;
  },

  /* ---- layout ---- */

  function density(s, ctx) {
    const direct = pickById(DENSITIES, s, {
      compact: ["tighter", "denser", "tight"],
      spacious: ["roomier", "airier", "more space"]
    });
    if (!direct) return null;
    if (!ctx.asked && s.split(" ").length > 3) return null;
    return { patch: { density: direct }, say: `Layout is ${label(DENSITIES, direct)}.` };
  },

  function width(s) {
    if (!/\b(?:width|wide|narrow|column|margins?)\b/.test(s)) return null;
    const direct = pickById(WIDTHS, s, { full: ["full width", "edge to edge"], medium: ["default"] });
    return direct ? { patch: { width: direct }, say: `Column is ${label(WIDTHS, direct)}.` } : null;
  },

  function corners(s) {
    if (!/\bcorners?|rounded|square\b/.test(s)) return null;
    const direct = pickById(CORNERS, s, { round: ["rounded", "rounder"], square: ["sharp", "squared"] });
    return direct ? { patch: { corners: direct }, say: `Corners are ${label(CORNERS, direct)}.` } : null;
  },

  function bubbles(s) {
    if (!/\bbubbles?\b/.test(s)) return null;
    const plain = off.test(s) || /\bplain\b/.test(s);
    return {
      patch: { bubbles: plain ? "plain" : "bubble" },
      say: plain ? "Your messages are plain." : "Your messages are bubbles."
    };
  },

  function motion(s) {
    if (!/\b(?:motion|animations?|transitions?)\b/.test(s)) return null;
    const reduce = off.test(s) || /\b(?:reduce|less|fewer|stop)\b/.test(s);
    return { patch: { reduceMotion: reduce }, say: reduce ? "Motion reduced." : "Motion on." };
  },

  /* ---- how it answers ---- */

  function depth(s) {
    if (!/\b(?:think|thinking|depth|effort|reasoning|search)\b/.test(s)) return null;
    if (/\b(?:quick|quicker|fast|faster|cheap|shallow|less)\b/.test(s)) {
      return { patch: { depth: "quick" }, say: "Thinking depth is quick." };
    }
    if (/\b(?:deep|deeper|thorough|hard|harder|more|careful)\b/.test(s)) {
      return { patch: { depth: "deep" }, say: "Thinking depth is deep." };
    }
    if (/\bbalanced\b/.test(s)) return { patch: { depth: "balanced" }, say: "Thinking depth is balanced." };
    return null;
  },

  function tone(s, ctx) {
    // "be more direct" arrives here as "more direct" — cleaning takes the verb
    // off, so the adjective in the body is what actually decides this rule.
    if (!ctx.asked) return null;
    if (!/\b(?:tone|voice|sound|talk|speak|write|answer|reply|be|more|less)\b/.test(s)) return null;
    if (/\b(?:direct|blunt|terse|concise|to the point|no fluff)\b/.test(s)) {
      return { patch: { tone: "direct" }, say: "Tone is direct." };
    }
    if (/\b(?:warm|warmer|friendly|kind|encouraging|gentle)\b/.test(s)) {
      return { patch: { tone: "warm" }, say: "Tone is warm." };
    }
    if (/\b(?:playful|funny|casual|relaxed|witty|light)\b/.test(s)) {
      return { patch: { tone: "playful" }, say: "Tone is playful." };
    }
    if (/\b(?:balanced|normal|neutral|default)\b/.test(s)) {
      return { patch: { tone: "balanced" }, say: "Tone is balanced." };
    }
    return null;
  },

  function length(s) {
    if (!/\b(?:answers?|replies|responses?|length)\b/.test(s)) return null;
    if (/\b(?:short|shorter|brief|briefer|concise)\b/.test(s)) {
      return { patch: { length: "brief" }, say: "Answers will be brief." };
    }
    if (/\b(?:long|longer|thorough|detailed|comprehensive|complete)\b/.test(s)) {
      return { patch: { length: "thorough" }, say: "Answers will be thorough." };
    }
    if (/\b(?:adaptive|normal|default|match)\b/.test(s)) {
      return { patch: { length: "adaptive" }, say: "Answer length will match the question." };
    }
    return null;
  },

  function search(s) {
    if (!/\b(?:web ?search|search the web|look things up|browsing|the internet)\b/.test(s)) return null;
    const wanted = !off.test(s) && (on.test(s) || !/\b(?:no|not)\b/.test(s));
    return { patch: { webSearch: wanted }, say: wanted ? "Web search on." : "Web search off." };
  },

  function callMe(s) {
    const found = /\b(?:call me|my name is|i'?m called|refer to me as)\s+([a-z][a-z' -]{0,38})$/.exec(s);
    if (!found) return null;
    const name = found[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
    return { patch: { callMe: name }, say: `You're ${name}.` };
  },

  /* ---- opening things ---- */
  //
  // Last, so "change the colours to sage" changes them rather than opening the
  // panel where you could have done it by hand.

  function navigate(s) {
    const go = /\b(?:open|show|go to|take me to|bring up|pull up|edit|adjust|change|customi[sz]e|settings|let me see)\b/;
    if (!go.test(s)) return null;

    const to = [
      [/\b(?:appearance|colou?rs?|theme|palette|design|look|styling|fonts?)\b/, "appearance", "Appearance"],
      [/\b(?:connectors?|integrations?|apps|accounts|github|mcp)\b/, "connectors", "Connectors"],
      [/\b(?:status|health|diagnostics|doctor|is it working)\b/, "status", "Status"],
      [/\b(?:assistant|personality|customi[sz]e|instructions|about me)\b/, "assistant", "Assistant"],
      [/\bsettings|preferences|options\b/, "assistant", "Settings"]
    ];

    for (const [pattern, tab, name] of to) {
      if (pattern.test(s)) {
        return { open: { section: "settings", tab }, say: `Opened ${name}.` };
      }
    }

    if (/\b(?:artifacts?|previews?|pages you (?:made|built))\b/.test(s)) {
      return { open: { section: "artifacts" }, say: "Opened Artifacts." };
    }
    return null;
  }
];

/* --------------------------------- entry --------------------------------- */

/**
 * Reads an instruction to the interface out of what someone typed or said.
 *
 * Returns null for anything that isn't clearly one — which is most text, and
 * deliberately so. A command that fires when it shouldn't costs someone their
 * message; one that doesn't fire costs a click.
 *
 * @param {string} text            what they wrote or spoke
 * @param {object} ctx
 * @param {object} ctx.settings    current settings, for relative changes
 * @param {Array}  ctx.themes      built-ins plus the person's own palettes
 * @returns {{say: string, patch?: object, open?: object, act?: string}|null}
 */
export function parseCommand(text, ctx = {}) {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 160) return null;

  const s = clean(raw);
  if (!s || isQuestion(raw, s)) return null;
  if (REFERENT.test(s)) return null;

  // More than a sentence is a message, whatever it contains.
  if (s.split(/\s+/).length > 16) return null;

  // Both forms: cleaning strips the politeness that carries the ask, so
  // "I want this app to be tan" arrives as "a tan color background" with no
  // verb left in it.
  const inner = { ...ctx, asked: DIRECTIVE.test(raw.toLowerCase()) || DIRECTIVE.test(s) };

  for (const rule of RULES) {
    const result = rule(s, inner);
    if (result) return { ...result, source: rule.name };
  }
  return null;
}

// Everything the parser understands, grouped for the hint under the composer.
// Written out rather than derived: these are the phrasings worth teaching, and
// a generated list would read like a grammar.
export const EXAMPLES = [
  { say: "make the background sage", does: "Re-tints the whole app from one colour" },
  { say: "accent blue", does: "Changes the highlight colour" },
  { say: "dark mode", does: "Switches to your dark theme" },
  { say: "bigger text", does: "One notch up the type scale" },
  { say: "use Lora", does: "Any font in the catalogue, by name" },
  { say: "open appearance", does: "Jumps straight to the panel" },
  { say: "be more direct", does: "Changes how it writes back" },
  { say: "keep answers short", does: "Sets the reply length" }
];
