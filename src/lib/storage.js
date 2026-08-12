// Chats live in this browser. Nothing is stored on a server, which keeps the
// app deployable with zero backend state — swap this module for API calls if
// you later want history to follow people across devices.

const KEY = "selflight.chats.v1";

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(chats) {
  try {
    localStorage.setItem(KEY, JSON.stringify(chats));
  } catch {
    // Storage blocked or full — the current session still works in memory.
  }
}

function patch(id, fields) {
  write(read().map((c) => (c.id === id ? { ...c, ...fields, updatedAt: Date.now() } : c)));
}

export function listChats() {
  return read().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function createChat({ title, messages }) {
  const chat = {
    id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    messages,
    updatedAt: Date.now()
  };
  write([chat, ...read()]);
  return chat;
}

export function saveMessages(id, messages) {
  patch(id, { messages });
}

export function renameChat(id, title) {
  patch(id, { title });
}

export function deleteChat(id) {
  write(read().filter((c) => c.id !== id));
}

export function fallbackTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 38 ? `${clean.slice(0, 38).trimEnd()}…` : clean;
}
