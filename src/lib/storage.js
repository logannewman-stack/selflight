// Everything lives in this browser. No accounts, no server-side state — swap
// these functions for API calls when you want history to follow people across
// devices.

const CHATS = "selflight.chats.v1";
const SETTINGS = "selflight.settings.v1";
const CONNECTORS = "selflight.connectors.v1";

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

function patchChat(id, fields) {
  save(
    CHATS,
    readChats().map((c) => (c.id === id ? { ...c, ...fields, updatedAt: Date.now() } : c))
  );
}

export function listChats() {
  return readChats().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function createChat({ title, messages }) {
  const chat = { id: uid("c"), title, messages, updatedAt: Date.now() };
  save(CHATS, [chat, ...readChats()]);
  return chat;
}

export function saveMessages(id, messages) {
  patchChat(id, { messages });
}

export function renameChat(id, title) {
  patchChat(id, { title });
}

export function deleteChat(id) {
  save(CHATS, readChats().filter((c) => c.id !== id));
}

export function fallbackTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 38 ? `${clean.slice(0, 38).trimEnd()}…` : clean;
}

/* ------------------------------ settings ------------------------------ */

export const DEFAULT_SETTINGS = {
  // Appearance
  theme: "paper",
  textSize: "md",
  reduceMotion: false,

  // Personality — folded into the system prompt on the server.
  tone: "balanced",
  length: "adaptive",
  depth: "balanced",
  callMe: "",
  about: "",
  instructions: "",

  // Capabilities
  webSearch: true,
  webFetch: true
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...load(SETTINGS, {}) };
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
