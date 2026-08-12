// One data interface, two backings.
//
// Signed out (or with no Supabase project configured) everything lives in this
// browser, exactly as it did before there were accounts. Signed in, the same
// calls go to Postgres and the work follows you between devices.
//
// Every method is async so App.jsx doesn't need to know which one it's talking
// to. That's the whole point of this file: the app asks for chats, not for
// localStorage or a table.

import { supabase } from "./supabase.js";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./storage.js";
import * as local from "./storage.js";
import { isDarkPalette } from "./palettes.js";
import { explain } from "./faults.js";
import * as localPalettes from "./palettes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Settings change on every click in the Design panel. Locally that's free;
// against a database it would be a write per keystroke on the hex fields.
function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = () => clearTimeout(timer);
  return wrapped;
}

// Somewhere to send failures other than the console.
//
// Every write here used to log and carry on, which meant a database that
// couldn't accept a message looked exactly like one that had — chats vanishing
// on refresh with nothing on screen to explain it. Storage failing is worth
// interrupting for: the alternative is losing work quietly.
let report = null;

export function onStoreError(fn) {
  report = fn;
}

function fail(context, error) {
  if (!error) return null;
  console.error(`[store] ${context}: ${error.message || error}`);
  report?.(explain(context, error));
  return error;
}

/* ------------------------------ this browser ----------------------------- */

const localStore = {
  remote: false,

  chats: {
    async list() {
      return local.listChats().map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
    },
    async messages(id) {
      return local.listChats().find((c) => c.id === id)?.messages || [];
    },
    async create(chat) {
      const { id, title, updatedAt } = local.createChat(chat);
      return { id, title, updatedAt };
    },
    async saveMessages(id, messages) {
      local.saveMessages(id, messages);
    },
    async rename(id, title) {
      local.renameChat(id, title);
    },
    async remove(id) {
      local.deleteChat(id);
    }
  },

  settings: {
    async load() {
      return loadSettings();
    },
    async save(settings) {
      saveSettings(settings);
    }
  },

  palettes: {
    async list() {
      return localPalettes.listPalettes();
    },
    async save(palette) {
      return localPalettes.savePalette(palette);
    },
    async remove(id) {
      localPalettes.deletePalette(id);
    }
  },

  connectors: {
    async list() {
      return local.listConnectors();
    },
    async add(data) {
      return local.addConnector(data);
    },
    async update(id, fields) {
      local.updateConnector(id, fields);
    },
    async remove(id) {
      local.removeConnector(id);
    }
  }
};

/* -------------------------------- Postgres ------------------------------- */

function remoteStore(user) {
  const uid = user.id;

  // Tokens are the one thing the browser cannot write: connector_secrets has
  // row-level security on and no policies, so only the server's service-role
  // key reaches it. The token goes out to our own function and never comes back.
  async function sendToken(connectorId, token) {
    const { data } = await supabase.auth.getSession();
    const jwt = data.session?.access_token;
    if (!jwt) return;

    const res = await fetch("/api/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ connectorId, token })
    });
    if (!res.ok) fail("storing a connector token", await res.json().catch(() => null));
  }

  const pushSettings = debounce(async (settings) => {
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: uid, settings }, { onConflict: "user_id" });
    fail("saving settings", error);
  }, 700);

  return {
    remote: true,

    chats: {
      async list() {
        const { data, error } = await supabase
          .from("chats")
          .select("id, title, updated_at")
          .order("updated_at", { ascending: false })
          .limit(200);
        fail("loading chats", error);
        return (data || []).map((row) => ({
          id: row.id,
          title: row.title,
          updatedAt: new Date(row.updated_at).getTime()
        }));
      },

      async messages(id) {
        const { data, error } = await supabase
          .from("messages")
          .select("role, content, sources, thinking, thought_ms, error")
          .eq("chat_id", id)
          .order("position");
        fail("loading a conversation", error);
        return (data || []).map((row) => ({
          role: row.role,
          text: row.content,
          ...(row.sources?.length ? { sources: row.sources } : {}),
          ...(row.thinking ? { thinking: row.thinking, thoughtMs: row.thought_ms } : {}),
          ...(row.error ? { error: true } : {})
        }));
      },

      async create({ title, messages }) {
        const { data, error } = await supabase
          .from("chats")
          .insert({ user_id: uid, title })
          .select("id, title, updated_at")
          .single();

        if (error || !data) {
          fail("starting a chat", error);
          // Losing the reply because the write failed would be worse than
          // losing the history, so carry on with an in-memory conversation.
          return { id: `pending-${Date.now()}`, title, updatedAt: Date.now(), pending: true };
        }

        await this.saveMessages(data.id, messages);
        return { id: data.id, title: data.title, updatedAt: new Date(data.updated_at).getTime() };
      },

      // The browser holds the authoritative thread, so this syncs by position:
      // upsert what's there now, then drop anything past the end. Regenerating a
      // reply overwrites position 5 instead of leaving two of them.
      async saveMessages(id, messages) {
        if (String(id).startsWith("pending-")) return;

        const rows = messages.map((m, position) => ({
          chat_id: id,
          position,
          user_id: uid,
          role: m.role,
          content: m.text ?? "",
          sources: m.sources || [],
          thinking: m.thinking || null,
          thought_ms: m.thoughtMs || null,
          error: Boolean(m.error)
        }));

        if (rows.length) {
          const { error } = await supabase
            .from("messages")
            .upsert(rows, { onConflict: "chat_id,position" });
          fail("saving messages", error);
        }

        const { error } = await supabase
          .from("messages")
          .delete()
          .eq("chat_id", id)
          .gte("position", rows.length);
        fail("trimming messages", error);
      },

      async rename(id, title) {
        if (String(id).startsWith("pending-")) return;
        const { error } = await supabase.from("chats").update({ title }).eq("id", id);
        fail("renaming a chat", error);
      },

      async remove(id) {
        const { error } = await supabase.from("chats").delete().eq("id", id);
        fail("deleting a chat", error);
      }
    },

    settings: {
      async load() {
        const { data, error } = await supabase
          .from("user_settings")
          .select("settings")
          .eq("user_id", uid)
          .maybeSingle();
        fail("loading settings", error);
        return { ...DEFAULT_SETTINGS, ...(data?.settings || {}) };
      },

      async save(settings) {
        pushSettings(settings);
      }
    },

    palettes: {
      async list() {
        const { data, error } = await supabase
          .from("palettes")
          .select("id, name, vars, dark, swatch")
          .order("created_at");
        fail("loading colour packages", error);
        return (data || []).map((row) => ({ ...row, custom: true }));
      },

      async save(palette) {
        const row = {
          user_id: uid,
          name: palette.name,
          vars: palette.vars,
          swatch: palette.swatch,
          dark: isDarkPalette(palette.vars)
        };

        // A brand-new draft carries a browser-made id; the database issues its
        // own, so an unsaved palette inserts and a saved one updates.
        const existing = UUID.test(String(palette.id));
        const query = existing
          ? supabase.from("palettes").update(row).eq("id", palette.id)
          : supabase.from("palettes").insert(row);

        const { data, error } = await query.select("id, name, vars, dark, swatch").single();
        if (error || !data) {
          fail("saving a colour package", error);
          return { ...palette, custom: true };
        }
        return { ...data, custom: true };
      },

      async remove(id) {
        const { error } = await supabase.from("palettes").delete().eq("id", id);
        fail("deleting a colour package", error);
      }
    },

    connectors: {
      async list() {
        const { data, error } = await supabase
          .from("connectors")
          .select("id, name, url, enabled, has_token")
          .order("created_at");
        fail("loading connectors", error);
        // `token` is never sent back — the row only admits that one exists.
        return (data || []).map((row) => ({
          id: row.id,
          name: row.name,
          url: row.url,
          enabled: row.enabled,
          hasToken: row.has_token,
          token: ""
        }));
      },

      async add({ name, url, token }) {
        const { data, error } = await supabase
          .from("connectors")
          .insert({ user_id: uid, name, url })
          .select("id, name, url, enabled, has_token")
          .single();

        if (error || !data) {
          fail("adding a connector", error);
          return null;
        }
        if (token) await sendToken(data.id, token);

        return { id: data.id, name, url, enabled: true, hasToken: Boolean(token), token: "" };
      },

      async update(id, fields) {
        const { token, ...rest } = fields;
        if (Object.keys(rest).length) {
          const { error } = await supabase.from("connectors").update(rest).eq("id", id);
          fail("updating a connector", error);
        }
        if (token !== undefined) await sendToken(id, token);
      },

      async remove(id) {
        const { error } = await supabase.from("connectors").delete().eq("id", id);
        fail("deleting a connector", error);
      }
    }
  };
}

export function storeFor(user) {
  return user && supabase ? remoteStore(user) : localStore;
}
