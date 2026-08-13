// Everything lives in this browser. No accounts, no server-side state — swap
// these functions for API calls when you want history to follow people across
// devices.

const CHATS = "selflight.chats.v1";
const SETTINGS = "selflight.settings.v1";
const CONNECTORS = "selflight.connectors.v1";
// Which conversation was open. Kept per device on purpose — a laptop and a
// phone signed into the same account should each reopen where they were.
const LAST = "selflight.lastChat.v1";

function load(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full — the current session still works in memory.
  }
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/* -------------------------------- chats ------------------------------- */

function readChats() {
  const chats = load(CHATS, []);
  return Array.isArray(chats) ? chats : [];
}

// localStorage is a few megabytes, and a long history eventually fills it.
// setItem then throws — which the generic save() swallowed, so chats quietly
// stopped being saved while everything still looked fine on screen. Dropping
// the oldest conversations and retrying loses the least, and a refusal to save
// at all is at least reported.
function saveChats(chats) {
  let keep = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  while (keep.length) {
    try {
      localStorage.setItem(CHATS, JSON.stringify(keep));
      if (keep.length < chats.length) {
        console.warn(
          `[storage] out of room — kept the ${keep.length} most recent chats, dropped ${
            chats.length - keep.length
          }. Sign in to keep history in the database instead.`
        );
      }
      return;
    } catch {
      // Halve it rather than shaving one at a time: a full store means a lot of
      // failed writes otherwise, and each one is slow.
      keep = keep.slice(0, Math.floor(keep.length / 2));
    }
  }

  console.error("[storage] this browser refused to save chats at all.");
}

function patchChat(id, fields, { touch = true } = {}) {
  saveChats(
    readChats().map((c) =>
      c.id === id ? { ...c, ...fields, ...(touch ? { updatedAt: Date.now() } : {}) } : c
    )
  );
}

// Pinned first, then most recent. The same order the remote store uses, so the
// sidebar doesn't reshuffle when someone signs in.
export function listChats() {
  return readChats().sort(
    (a, b) => Number(b.pinned || false) - Number(a.pinned || false) || (b.updatedAt || 0) - (a.updatedAt || 0)
  );
}

export function setPinned(id, pinned) {
  // Deliberately doesn't touch updatedAt: pinning is about where a chat sits,
  // and bumping it to "just now" would misdate a conversation from last month.
  patchChat(id, { pinned: Boolean(pinned) }, { touch: false });
}

/**
 * Finds a phrase inside conversations, not just in their titles.
 *
 * Returns one hit per chat — the first matching message — because a list with
 * six rows from the same conversation buries the other five conversations that
 * also matched.
 */
export function searchMessages(query, limit = 30) {
  const needle = String(query || "").trim().toLowerCase();
  if (needle.length < 2) return [];

  const hits = [];
  for (const chat of listChats()) {
    const found = (chat.messages || []).find((m) =>
      String(m.text || "").toLowerCase().includes(needle)
    );
    if (found) {
      hits.push({ chatId: chat.id, title: chat.title, snippet: found.text, role: found.role });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

export function createChat({ title, messages }) {
  const chat = { id: uid("c"), title, messages, pinned: false, updatedAt: Date.now() };
  saveChats([chat, ...readChats()]);
  return chat;
}

/* --------------------------- where you left off -------------------------- */

export function rememberChat(id) {
  try {
    if (id) localStorage.setItem(LAST, id);
    else localStorage.removeItem(LAST);
  } catch {
    // Reopening the last chat is a convenience; losing it is survivable.
  }
}

export function lastChat() {
  try {
    return localStorage.getItem(LAST);
  } catch {
    return null;
  }
}

export function saveMessages(id, messages) {
  patchChat(id, { messages });
}

export function renameChat(id, title) {
  // Same reasoning as pinning — renaming is not activity.
  patchChat(id, { title }, { touch: false });
}

export function deleteChat(id) {
  saveChats(readChats().filter((c) => c.id !== id));
}

export function fallbackTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 38 ? `${clean.slice(0, 38).trimEnd()}…` : clean;
}

/* ------------------------------ settings ------------------------------ */

export const DEFAULT_SETTINGS = {
  // Colour
  //
  // High contrast is what ships. It's the palette that's legible to the most
  // people — 21:1 body text against 12.6:1 for Paper — and everything else is
  // one click away in Appearance. Defaulting to the prettiest option and
  // leaving legibility as a setting gets it backwards: the people who need
  // this most are the least likely to go looking for it.
  //
  // Only new browsers are affected. loadSettings() merges what's stored over
  // these, so anyone who already picked a palette keeps it.
  theme: "contrast",
  matchSystem: false,
  lightTheme: "contrast",
  darkTheme: "contrast-dark",
  accent: "palette",
  accentCustom: "",
  // A colour the whole interface is derived from. Empty means the palette's own.
  baseColor: "",

  // Layout
  density: "comfortable",
  width: "medium",
  corners: "soft",
  bubbles: "bubble",

  // Type — ids from src/lib/fonts.js
  uiFont: "geist",
  replyFont: "geist",
  codeFont: "geist-mono",
  textSize: "md",
  lineSpacing: "normal",
  bodyWeight: "regular",
  tracking: "normal",
  headingScale: "normal",
  paraSpacing: "normal",
  reduceMotion: false,

  // Code
  codeSize: "md",
  codeWrap: false,
  lineNumbers: false,

  // Behaviour
  sendKey: "enter",
  autoArtifacts: false,

  // Personality — folded into the system prompt on the server.
  tone: "balanced",
  length: "adaptive",
  // Deep, because it's the tier whose model actually writes down its
  // reasoning — and the thought process is worth seeing. It costs about the
  // same as balanced: sonar-reasoning-pro is $2/$8 per million against
  // sonar-pro's $3/$15, which roughly cancels the deeper search fee.
  depth: "deep",
  callMe: "",
  about: "",
  instructions: "",

  // Capabilities
  webSearch: true,
  webFetch: true
};

// Earlier builds stored a three-way typeface choice; map it onto the font
// catalogue so an existing browser doesn't silently lose its selection.
const FACE_TO_FONT = { geist: "geist", serif: "source-serif", system: "system" };

export function loadSettings() {
  const stored = load(SETTINGS, {}) || {};
  const merged = { ...DEFAULT_SETTINGS, ...stored };

  if (stored.uiFace && !stored.uiFont) merged.uiFont = FACE_TO_FONT[stored.uiFace] || "geist";
  if (stored.readingFace && !stored.replyFont) {
    merged.replyFont = FACE_TO_FONT[stored.readingFace] || "geist";
  }
  return merged;
}

export function saveSettings(settings) {
  save(SETTINGS, settings);
}

/* ----------------------------- connectors ----------------------------- */

export function listConnectors() {
  const connectors = load(CONNECTORS, []);
  return Array.isArray(connectors) ? connectors : [];
}

export function addConnector({ name, url, token }) {
  const connector = { id: uid("mcp"), name, url, token: token || "", enabled: true };
  save(CONNECTORS, [...listConnectors(), connector]);
  return connector;
}

export function updateConnector(id, fields) {
  save(CONNECTORS, listConnectors().map((c) => (c.id === id ? { ...c, ...fields } : c)));
}

export function removeConnector(id) {
  save(CONNECTORS, listConnectors().filter((c) => c.id !== id));
}
