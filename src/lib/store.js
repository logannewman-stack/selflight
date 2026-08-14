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
import { loadSettings, migrate, saveSettings } from "./storage.js";
import * as local from "./storage.js";
import { isDarkPalette } from "./palettes.js";
import { explain } from "./faults.js";
import * as localPalettes from "./palettes.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Settings change on every click in the Design panel. Locally that's free;
// against a database it would be a write per keystroke on the hex fields.
function debounce(fn, ms) {
  let timer;
  let pending = null;

  const wrapped = (...args) => {
    pending = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = null;
      fn(...args);
    }, ms);
  };

  // Runs the pending call rather than cancelling it. It used to only clear the
  // timer, which is the opposite of what the name promises: a colour changed
  // and a tab closed inside the same 700ms lost the change silently, and looked
  // exactly like a setting that doesn't save.
  wrapped.flush = () => {
    if (!pending) return;
    const args = pending;
    pending = null;
    clearTimeout(timer);
    fn(...args);
  };

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
      return local.listChats().map(({ id, title, updatedAt, pinned, projectId }) => ({
        id,
        title,
        updatedAt,
        pinned: Boolean(pinned),
        projectId: projectId || null
      }));
    },
    async search(query) {
      return local.searchMessages(query);
    },
    async setPinned(id, pinned) {
      local.setPinned(id, pinned);
    },
    async messages(id) {
      return local.listChats().find((c) => c.id === id)?.messages || [];
    },
    async create(chat) {
      const { id, title, updatedAt, projectId } = local.createChat(chat);
      return { id, title, updatedAt, projectId };
    },
    async setProject(id, projectId) {
      local.setChatProject(id, projectId);
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
    },
    // localStorage is synchronous, so there is never anything in flight.
    flush() {}
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

  projects: {
    async list() {
      return local.listProjects();
    },
    async create(project) {
      return local.createProject(project);
    },
    async update(id, fields) {
      local.updateProject(id, fields);
    },
    async remove(id) {
      local.deleteProject(id);
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
          .select("id, title, updated_at, pinned, project_id")
          // Pinned first, then most recent — matching the local store, so the
          // sidebar doesn't reshuffle when somebody signs in.
          .order("pinned", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(200);
        fail("loading chats", error);
        return (data || []).map((row) => ({
          id: row.id,
          title: row.title,
          pinned: Boolean(row.pinned),
          projectId: row.project_id || null,
          updatedAt: new Date(row.updated_at).getTime()
        }));
      },

      /**
       * Finds a phrase inside conversations, using the generated tsvector from
       * 0006_chats.sql rather than a LIKE scan — fine for a hundred messages,
       * unusable at a hundred thousand, and painful to retrofit under traffic.
       *
       * One hit per chat: six rows from the same conversation would bury the
       * five other conversations that also matched.
       */
      async search(query) {
        const needle = String(query || "").trim();
        if (needle.length < 2) return [];

        const { data, error } = await supabase
          .from("messages")
          .select("chat_id, content, role, chats!inner(title)")
          .textSearch("search", needle, { type: "websearch", config: "english" })
          .limit(60);

        if (error) {
          fail("searching conversations", error);
          return [];
        }

        const seen = new Set();
        const hits = [];
        for (const row of data || []) {
          if (seen.has(row.chat_id)) continue;
          seen.add(row.chat_id);
          hits.push({
            chatId: row.chat_id,
            title: row.chats?.title || "Untitled",
            snippet: row.content,
            role: row.role
          });
        }
        return hits;
      },

      async setPinned(id, pinned) {
        if (String(id).startsWith("pending-")) return;
        const { error } = await supabase.from("chats").update({ pinned }).eq("id", id);
        fail("pinning a chat", error);
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

      async create({ title, messages, projectId = null }) {
        const { data, error } = await supabase
          .from("chats")
          .insert({ user_id: uid, title, project_id: projectId })
          .select("id, title, updated_at, project_id")
          .single();

        if (error || !data) {
          fail("starting a chat", error);
          // Losing the reply because the write failed would be worse than
          // losing the history, so carry on with an in-memory conversation.
          return { id: `pending-${Date.now()}`, title, projectId, updatedAt: Date.now(), pending: true };
        }

        await this.saveMessages(data.id, messages);
        return {
          id: data.id,
          title: data.title,
          projectId: data.project_id || null,
          updatedAt: new Date(data.updated_at).getTime()
        };
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

      async setProject(id, projectId) {
        if (String(id).startsWith("pending-")) return;
        const { error } = await supabase
          .from("chats")
          .update({ project_id: projectId || null })
          .eq("id", id);
        fail("moving a chat into a project", error);
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
        // Through the same migration as the local store. A signed-in account
        // keeps its settings in Postgres, so clearing the browser wouldn't move
        // them — and that's the copy that matters for anyone actually using it.
        return migrate(data?.settings || {});
      },

      async save(settings) {
        pushSettings(settings);
      },
      // Called when the page is being hidden or closed, so the last change
      // doesn't die inside the debounce window.
      flush() {
        pushSettings.flush();
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

    projects: {
      async list() {
        const { data, error } = await supabase
          .from("projects")
          .select("id, name, instructions, updated_at")
          .order("updated_at", { ascending: false });
        fail("loading projects", error);
        return (data || []).map((row) => ({
          id: row.id,
          name: row.name,
          instructions: row.instructions || "",
          updatedAt: new Date(row.updated_at).getTime()
        }));
      },

      async create({ name, instructions = "" }) {
        const { data, error } = await supabase
          .from("projects")
          .insert({ user_id: uid, name, instructions })
          .select("id, name, instructions, updated_at")
          .single();
        if (error || !data) {
          fail("starting a project", error);
          return null;
        }
        return { ...data, instructions: data.instructions || "" };
      },

      async update(id, fields) {
        const patch = { updated_at: new Date().toISOString() };
        if (fields.name !== undefined) patch.name = fields.name;
        if (fields.instructions !== undefined) patch.instructions = fields.instructions;
        const { error } = await supabase.from("projects").update(patch).eq("id", id);
        fail("saving a project", error);
      },

      // The chats survive; project_id is `on delete set null`. A delete that
      // silently took a month of conversations with it would be unforgivable.
      async remove(id) {
        const { error } = await supabase.from("projects").delete().eq("id", id);
        fail("deleting a project", error);
      }
    },

    connectors: {
      async list() {
        const { data, error } = await supabase
          .from("connectors")
          .select("id, name, url, enabled, has_token, provider, account")
          .order("created_at");
        fail("loading connectors", error);
        // `token` is never sent back — the row only admits that one exists.
        // `provider` and `account` are how a connection made by signing in
        // tells itself apart from a server URL somebody typed.
        return (data || []).map((row) => ({
          id: row.id,
          name: row.name,
          url: row.url,
          enabled: row.enabled,
          hasToken: row.has_token,
          provider: row.provider || null,
          account: row.account || null,
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
