import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Globe, Info, Link2, PanelLeft, Plus, RotateCw, Search, Sparkles, Wand2 } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Message from "./components/Message.jsx";
import Composer from "./components/Composer.jsx";
import RightPanel from "./components/RightPanel.jsx";
import SignIn from "./components/SignIn.jsx";
import Setup from "./components/Setup.jsx";
import Logo from "./components/Logo.jsx";
import Build from "./components/panels/Build.jsx";
import { capabilities, generateTitle, streamChat } from "./lib/api.js";
import { extractArtifacts } from "./lib/artifacts.js";
import { BUILT_IN_THEMES, applyFonts, applyTheme, resolvePalette } from "./lib/themes.js";
import * as fontCatalogue from "./lib/fonts.js";
import { draftFrom, importPalette, refreshSwatch } from "./lib/palettes.js";
import { modeLabel } from "./lib/brand.js";
import { parseCommand } from "./lib/commands.js";
import { createThreadCache } from "./lib/threads.js";
import { withAttachments } from "./lib/attach.js";
import { fallbackTitle, lastChat, loadSettings, rememberChat } from "./lib/storage.js";
import { onStoreError, storeFor } from "./lib/store.js";
import { hasSupabase, supabase } from "./lib/supabase.js";

const SUGGESTIONS = [
  "Explain something I'm stuck on",
  "What changed in the news today?",
  "Think through a decision with me",
  "Find the flaw in this plan"
];

const ACTIVITY_ICONS = { search: Search, fetch: Globe, connector: Link2, tool: Sparkles };

export default function App() {
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [activity, setActivity] = useState(null);

  // Whatever this browser last used, so the first paint is already themed while
  // the account's real settings are still on their way.
  const [settings, setSettings] = useState(() => loadSettings());
  const [connectors, setConnectors] = useState([]);
  const [palettes, setPalettes] = useState([]);
  // An unsaved palette being edited. While set, it previews over the real theme.
  const [draft, setDraft] = useState(null);

  // Signed out, or with no Supabase project configured, the store is this
  // browser. Signed in, it's Postgres. Nothing below this line knows which.
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!hasSupabase);
  const store = useMemo(() => storeFor(user), [user?.id]);
  // Rebuilt with the store on purpose: a cache that outlived a sign-out would
  // hold the previous account's conversations in memory.
  const threads = useMemo(() => createThreadCache(store), [store]);
  // Which store the loaded data belongs to. Compared by identity so a settings
  // write can never land in the account it wasn't read from.
  const [loadedFor, setLoadedFor] = useState(null);

  // What the configured model can do. Until it answers, assume the fuller set —
  // hiding a working feature for a moment is worse than showing it.
  const [can, setCan] = useState({ provider: null, connectors: true, searchAlwaysOn: false });
  // Set once the setup screen has been dismissed, so it can be looked at again
  // without being stuck behind it.
  const [setupDone, setSetupDone] = useState(false);
  // A database that can't store what it's given. Held until dismissed, because
  // the alternative is losing work with nothing on screen to explain it.
  const [storeFault, setStoreFault] = useState(null);
  // The last thing the composer was read as an instruction rather than a
  // message. Holds what it did, what was typed, and the settings from before —
  // so it can be taken back, or sent as a message after all.
  const [command, setCommand] = useState(null);
  // True only while a chat with nothing cached is being fetched. Distinct from
  // "no messages", which is a real and different screen.
  const [loadingThread, setLoadingThread] = useState(false);
  // Which turn is being rewritten, by index. Null when nobody is editing.
  const [editingAt, setEditingAt] = useState(null);
  // Files staged for the next message. They're read in the browser and folded
  // into the message text on send — there is no upload and nothing is stored
  // anywhere but the conversation itself.
  const [attachments, setAttachments] = useState([]);

  const [mode, setMode] = useState("chat");
  const [section, setSection] = useState(null);
  const [settingsTab, setSettingsTab] = useState("assistant");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Auto-scroll only while the reader is already at the bottom, so scrolling up
  // to re-read something mid-reply doesn't yank them back down.
  const [pinned, setPinned] = useState(true);
  const [focusSignal, setFocusSignal] = useState(0);
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false
  );

  const threadRef = useRef(null);
  const abortRef = useRef(null);
  // The turn in flight writes to whichever chat it started in, so switching
  // chats mid-stream can't drop a reply into the wrong conversation.
  const chatIdRef = useRef(null);
  const artifactCountRef = useRef(0);
  // Where each conversation was left. Reopening a long thread at the bottom
  // loses the place you were reading, which is the difference between a chat
  // app and a document you can live in.
  const scrollAtRef = useRef(new Map());

  const artifacts = useMemo(() => extractArtifacts(messages), [messages]);

  const themes = useMemo(() => [...BUILT_IN_THEMES, ...palettes], [palettes]);

  useEffect(() => {
    applyTheme(settings, { prefersDark, themes, override: draft });
  }, [settings, prefersDark, themes, draft]);

  // Only write settings belonging to the store they were read from, or signing
  // in would push this browser's defaults over the account's saved ones.
  useEffect(() => {
    if (loadedFor === store) store.settings.save(settings);
  }, [settings, loadedFor, store]);

  useEffect(() => {
    applyFonts(settings, fontCatalogue);
  }, [settings.uiFont, settings.replyFont, settings.codeFont]);

  useEffect(() => {
    capabilities().then((next) => next && setCan(next));
  }, []);

  // Coming back from a provider's sign-in screen. The callback can't render
  // anything — it's a redirect — so it says how it went in the query string and
  // this puts the person back where they pressed the button.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const failed = params.get("connectError");
    if (!connected && !failed) return;

    setSettingsTab("connectors");
    setSection("settings");
    setCommand({ say: failed || `Connected to ${connected}.`, text: null, before: null });

    // Leave the address bar clean, so a refresh doesn't repeat the message.
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // A fatal fault stays put; anything transient is replaced by whatever came
  // last, so one bad moment doesn't pin an old message to the screen.
  useEffect(() => {
    onStoreError((fault) => setStoreFault((current) => (current?.fatal ? current : fault)));
    return () => onStoreError(null);
  }, []);

  /* --------------------------------- auth -------------------------------- */

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });

    // Fires on sign-in, sign-out, token refresh, and on the magic-link return.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Everything the account owns, loaded together whenever the account changes.
  useEffect(() => {
    let live = true;
    setLoadedFor(null);

    (async () => {
      // Read before anything is written: the pointer has to survive this
      // effect's own state updates.
      const wanted = lastChat();

      const [nextChats, nextSettings, nextPalettes, nextConnectors] = await Promise.all([
        store.chats.list(),
        store.settings.load(),
        store.palettes.list(),
        store.connectors.list()
      ]);
      if (!live) return;

      setChats(nextChats);
      setSettings(nextSettings);
      setPalettes(nextPalettes);
      setConnectors(nextConnectors);

      // Land back in the conversation you were reading rather than on a blank
      // one. Only if it's still there — a chat deleted on another device, or one
      // belonging to the account you just signed out of, shouldn't reopen.
      const previous = nextChats.find((c) => c.id === wanted);
      const history = previous ? await store.chats.messages(previous.id) : [];
      if (!live) return;

      chatIdRef.current = previous?.id ?? null;
      setActiveId(previous?.id ?? null);
      setMessages(history);
      if (previous) threads.update(previous.id, history);
      setLoadedFor(store);
    })();

    return () => {
      live = false;
    };
  }, [store, threads]);

  // Gated on the load having finished, or the null this starts at would erase
  // the pointer before the effect above ever got to read it.
  useEffect(() => {
    if (loadedFor === store) rememberChat(activeId);
  }, [activeId, loadedFor, store]);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setSection(null);
    setDraft(null);
  }, []);

  // "Match system" needs the OS preference live, not only at first paint.
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const onChange = (e) => setPrefersDark(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (settings.autoArtifacts && artifacts.length > artifactCountRef.current) {
      setSection("artifacts");
    }
    artifactCountRef.current = artifacts.length;
  }, [artifacts.length, settings.autoArtifacts]);

  useEffect(() => {
    if (!pinned) return;
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, activity, pinned]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setPinned(atBottom);
    // Only remember a position that isn't the bottom — "the end" is where a
    // conversation reopens anyway, and storing it would defeat the pin logic.
    if (chatIdRef.current) {
      if (atBottom) scrollAtRef.current.delete(chatIdRef.current);
      else scrollAtRef.current.set(chatIdRef.current, el.scrollTop);
    }
  };

  const jumpToLatest = () => {
    setPinned(true);
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  };

  const updateSettings = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const newChat = useCallback(() => {
    stop();
    chatIdRef.current = null;
    setActiveId(null);
    setMessages([]);
    setAttachments([]);
    setError(null);
    setNotice(null);
    setStreaming(false);
    setMode("chat");
    setDrawerOpen(false);
    setPinned(true);
    setFocusSignal((n) => n + 1);
  }, [stop]);

  const openChat = useCallback(
    async (chat) => {
      stop();
      chatIdRef.current = chat.id;
      setActiveId(chat.id);
      // Files staged in one conversation shouldn't follow you into another.
      setAttachments([]);
      setError(null);
      setNotice(null);
      setStreaming(false);
      setMode("chat");
      setDrawerOpen(false);
      setPinned(true);
      setFocusSignal((n) => n + 1);

      // A conversation we've already read reopens with no wait at all. This is
      // the difference between a tap that feels like a tab switch and one that
      // shows a blank screen while a database answers.
      const cached = threads.peek(chat.id);
      setMessages(cached ?? []);
      // Only claim to be loading when there's genuinely nothing to show —
      // otherwise the skeleton flashes over a conversation that's already there.
      setLoadingThread(!cached);

      const resume = scrollAtRef.current.get(chat.id);
      // Opening mid-thread means the auto-scroll must not drag them to the
      // bottom the moment the messages render.
      setPinned(resume === undefined);

      try {
        const history = await threads.load(chat.id);
        // A second tap while this was in flight wins; don't overwrite it.
        if (chatIdRef.current === chat.id) {
          setMessages(history);
          if (resume !== undefined) {
            // After paint, so the thread has a scroll height to move within.
            requestAnimationFrame(() => {
              if (chatIdRef.current === chat.id && threadRef.current) {
                threadRef.current.scrollTop = resume;
              }
            });
          }
        }
      } finally {
        if (chatIdRef.current === chat.id) setLoadingThread(false);
      }
    },
    [stop, threads]
  );

  const searchChats = useCallback((query) => store.chats.search(query), [store]);

  const pinChat = useCallback(
    async (id, pinned) => {
      // Reordered locally first so the row moves under the finger that pressed
      // it; the write behind it is a formality.
      setChats((current) =>
        [...current.map((c) => (c.id === id ? { ...c, pinned } : c))].sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0)
        )
      );
      await store.chats.setPinned(id, pinned);
    },
    [store]
  );

  const renameChat = useCallback(
    async (id, title) => {
      setChats((current) => current.map((c) => (c.id === id ? { ...c, title } : c)));
      await store.chats.rename(id, title);
    },
    [store]
  );

  const removeChat = useCallback(
    async (id) => {
      await store.chats.remove(id);
      threads.forget(id);
      setChats(await store.chats.list());
      if (chatIdRef.current === id) newChat();
    },
    [newChat, store, threads]
  );

  const toggleSection = useCallback((next, tab) => {
    setDraft(null);
    if (tab) setSettingsTab(tab);
    setSection((current) => {
      // Re-clicking a nav item closes the panel, except when it points at a
      // different Settings tab than the one already showing.
      const sameTarget = current === next && (!tab || tab === settingsTab);
      return sameTarget ? null : next;
    });
    setDrawerOpen(false);
  }, [settingsTab]);

  const closePanel = useCallback(() => {
    setDraft(null);
    setSection(null);
  }, []);

  /* ------------------------- saying it instead of clicking ------------------ */

  // Applies an instruction read out of the composer. Voice needs nothing extra:
  // dictation writes into the same box, so a spoken sentence arrives here by the
  // same route a typed one does.
  const runCommand = useCallback(
    (cmd, text) => {
      if (cmd.patch) setSettings((s) => ({ ...s, ...cmd.patch }));

      if (cmd.open) {
        setDraft(null);
        if (cmd.open.tab) setSettingsTab(cmd.open.tab);
        setSection(cmd.open.section);
      }

      if (cmd.act === "newChat") newChat();
      if (cmd.act === "close") closePanel();
      if (cmd.act === "signOut") signOut();

      // `before` is only kept for changes worth taking back in one press. A
      // panel that opened can be closed again; a repainted app is harder to
      // reverse by hand once you've forgotten what it looked like.
      setCommand({ say: cmd.say, text, before: cmd.patch ? settings : null });
    },
    [settings, newChat, closePanel, signOut]
  );

  const undoCommand = useCallback(() => {
    setCommand((c) => {
      if (c?.before) setSettings(c.before);
      return null;
    });
  }, []);

  // A confirmation, not a state. It goes away on its own.
  useEffect(() => {
    if (!command) return;
    const timer = setTimeout(() => setCommand(null), 12000);
    return () => clearTimeout(timer);
  }, [command]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        setDraft(null);
        setSection(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  const runTurn = async (base, chatId) => {
    const isCurrent = () => chatIdRef.current === chatId;

    setError(null);
    setNotice(null);
    setActivity(null);
    setStreaming(true);
    if (isCurrent()) setMessages([...base, { role: "selflight", text: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;

    let acc = "";
    let think = "";
    let sources = [];
    let failed = null;
    const startedAt = Date.now();

    // Sources arrive before the text on a search-grounded model, so the reply
    // carries whatever has landed by the time each chunk repaints. Thinking
    // arrives before both.
    const reply = () => ({
      role: "selflight",
      text: acc,
      ...(think ? { thinking: think, thoughtMs: Date.now() - startedAt } : {}),
      ...(sources.length ? { sources } : {})
    });

    // Everything that happens before the answer goes into one narration: the
    // reasoning the model writes, and the searches it runs. Two competing
    // displays of "what is it doing" would fight for the same attention.
    const narrate = (chunk) => {
      think += chunk;
      if (isCurrent()) setMessages([...base, reply()]);
    };

    try {
      await streamChat(base, {
        signal: controller.signal,
        settings,
        connectors,
        onThinking: narrate,
        onActivity: (next) => {
          if (!isCurrent()) return;
          setActivity(next);
          // Tool use is part of the thought process, so it reads as a line in
          // it rather than as a separate status elsewhere.
          narrate(`${think && !think.endsWith("\n\n") ? "\n\n" : ""}${next.label}…\n\n`);
        },
        onNotice: (text) => isCurrent() && setNotice(text),
        onSources: (next) => {
          sources = next;
          if (isCurrent() && acc) setMessages([...base, reply()]);
        },
        onText: (chunk) => {
          acc += chunk;
          if (isCurrent()) {
            setActivity(null);
            setMessages([...base, reply()]);
          }
        }
      });
    } catch (err) {
      // A stop button press is a normal ending, not a failure.
      if (err.name !== "AbortError") failed = err;
    }

    const final = acc ? [...base, reply()] : base;

    setStreaming(false);
    setActivity(null);
    abortRef.current = null;

    if (isCurrent()) {
      setMessages(final);
      if (failed) setError(failed.message);
    }

    await store.chats.saveMessages(chatId, final);
    // The browser holds the authoritative thread while a turn is in flight, so
    // this version is more current than the database's, not less.
    threads.update(chatId, final);
    setChats(await store.chats.list());
    return { final, failed };
  };

  const send = async (raw, { asCommand = true } = {}) => {
    const text = (raw ?? input).trim();
    const files = attachments;
    // A file on its own is a message; text on its own is too. Nothing at all
    // isn't.
    if ((!text && !files.length) || streaming) return;

    // Checked before the model is ever contacted: an instruction to the
    // interface is answered by the interface, instantly and for nothing.
    // Skipped when files are attached — "make this darker" with a stylesheet
    // attached is a question about the file, not an instruction to the app.
    if (asCommand && !files.length) {
      const cmd = parseCommand(text, { settings, themes, prefersDark });
      if (cmd) {
        runCommand(cmd, text);
        setInput("");
        return;
      }
    }
    setCommand(null);

    // The file contents live inside the message: it's what every provider
    // takes, what the messages table already stores, and what full-text search
    // already indexes. The interface splits it apart again for display.
    const base = [...messages, { role: "user", text: withAttachments(text, files) }];
    setInput("");
    setAttachments([]);
    // Show the question straight away — the write behind it can take a moment.
    setMessages(base);

    let chatId = chatIdRef.current;
    const isNew = !chatId;

    if (isNew) {
      // Store the user's turn before the model answers, so a refresh mid-reply
      // still leaves the question in history.
      const chat = await store.chats.create({
        title: fallbackTitle(text || files[0]?.name),
        messages: base
      });
      chatId = chat.id;
      chatIdRef.current = chatId;
      setActiveId(chatId);
    } else {
      await store.chats.saveMessages(chatId, base);
    }
    setChats(await store.chats.list());

    const { final, failed } = await runTurn(base, chatId);

    if (isNew && !failed) {
      const title = await generateTitle(final);
      if (title) {
        await store.chats.rename(chatId, title);
        setChats(await store.chats.list());
      }
    }
  };

  // The escape hatch that lets the parser be useful without being risky: if it
  // read a real message as an instruction, this costs one press to put right.
  // Defined after send() so it can never close over a stale one.
  const sendAnyway = () => {
    const text = command?.text;
    if (command?.before) setSettings(command.before);
    setCommand(null);
    if (text) send(text, { asCommand: false });
  };

  // Rewriting a question rather than arguing with the answer. Everything after
  // the edited turn goes, because a reply to a question that changed is no
  // longer a reply to anything — and the messages table is keyed by position
  // precisely so this can overwrite rather than append.
  const editMessage = async (index, text) => {
    setEditingAt(null);
    const trimmed = String(text || "").trim();
    if (!trimmed || streaming) return;

    const base = [...messages.slice(0, index), { role: "user", text: trimmed }];
    setMessages(base);

    const chatId = chatIdRef.current;
    if (!chatId) return;

    await store.chats.saveMessages(chatId, base);
    threads.update(chatId, base);
    await runTurn(base, chatId);
  };

  const retry = () => {
    if (streaming || !chatIdRef.current) return;
    const base = [...messages];
    while (base.length && base[base.length - 1].role !== "user") base.pop();
    if (base.length) runTurn(base, chatIdRef.current);
  };

  const selectPalette = (saved) =>
    setSettings((s) =>
      s.matchSystem
        ? { ...s, [saved.dark ? "darkTheme" : "lightTheme"]: saved.id }
        : { ...s, theme: saved.id }
    );

  const paletteApi = {
    draft,
    existing: draft ? palettes.some((p) => p.id === draft.id) : false,

    create: () => {
      setDraft(refreshSwatch(draftFrom(resolvePalette(settings, prefersDark, themes), "My palette")));
      setSection("palette");
    },

    // Editing one of your own packages edits it in place; a built-in is
    // duplicated instead, so the presets stay intact.
    edit: (theme) => {
      setDraft(
        theme.custom
          ? { ...theme, vars: { ...theme.vars } }
          : refreshSwatch(draftFrom(theme, `${theme.name} copy`))
      );
      setSection("palette");
    },

    change: (next) => setDraft(refreshSwatch(next)),

    // Reload every colour from a chosen palette, keeping the draft's identity.
    rebase: (base) =>
      setDraft((d) => refreshSwatch({ ...d, vars: { ...base.vars }, dark: base.dark })),

    save: async () => {
      const saved = await store.palettes.save(refreshSwatch(draft));
      setPalettes(await store.palettes.list());
      setDraft(null);
      selectPalette(saved);
      setSettingsTab("appearance");
      setSection("settings");
    },

    cancel: () => {
      setDraft(null);
      setSettingsTab("appearance");
      setSection("settings");
    },

    remove: async () => {
      const id = draft.id;
      await store.palettes.remove(id);
      setPalettes(await store.palettes.list());
      setDraft(null);
      // Anything still pointing at the deleted package falls back to a built-in.
      setSettings((s) => ({
        ...s,
        theme: s.theme === id ? "paper" : s.theme,
        lightTheme: s.lightTheme === id ? "paper" : s.lightTheme,
        darkTheme: s.darkTheme === id ? "midnight" : s.darkTheme
      }));
      setSettingsTab("appearance");
      setSection("settings");
    },

    import: async (text) => {
      try {
        const imported = importPalette(text, resolvePalette(settings, prefersDark, themes));
        const saved = await store.palettes.save(imported);
        setPalettes(await store.palettes.list());
        selectPalette(saved);
        return null;
      } catch (err) {
        return err.message;
      }
    }
  };

  const connectorApi = {
    items: connectors,
    // Tokens behave differently with an account behind them: write-only rather
    // than sitting in this browser, so the panel says something different too.
    signedIn: Boolean(user),
    can,
    add: async (data) => {
      await store.connectors.add(data);
      setConnectors(await store.connectors.list());
    },
    update: async (id, fields) => {
      await store.connectors.update(id, fields);
      setConnectors(await store.connectors.list());
    },
    remove: async (id) => {
      await store.connectors.remove(id);
      setConnectors(await store.connectors.list());
    }
  };

  const sidebar = (onCollapse) => (
    <Sidebar
      chats={chats}
      activeId={activeId}
      mode={mode}
      onMode={(m) => {
        setMode(m);
        setDrawerOpen(false);
      }}
      section={section}
      settingsTab={settingsTab}
      onSection={toggleSection}
      artifactCount={artifacts.length}
      connectorCount={connectors.filter((c) => c.enabled).length}
      name={settings.callMe}
      email={user?.email}
      onSignOut={user ? signOut : null}
      onNew={newChat}
      onOpen={openChat}
      onPrefetch={(id) => threads.warm(id)}
      onSearch={searchChats}
      onPin={pinChat}
      onRename={renameChat}
      onDelete={removeChat}
      onCollapse={onCollapse}
    />
  );

  const activeTitle = chats.find((c) => c.id === activeId)?.title;
  const ActivityIcon = activity ? ACTIVITY_ICONS[activity.kind] || Sparkles : null;
  const enabledConnectors = connectors.filter((c) => c.enabled).length;

  // The theme is already applied to <html>, so an empty page here is a themed
  // one rather than a white flash.
  if (!authReady) return <div className="h-full bg-page" />;

  // Nothing can work without a model key, and "type a message, get an error"
  // is a poor way to learn that. Say what's missing and how to fix it instead.
  if (can.configured === false && !setupDone) return <Setup onDone={() => setSetupDone(true)} />;

  if (hasSupabase && !user) return <SignIn />;

  return (
    <div className="flex h-full overflow-hidden">
      {sidebarOpen && (
        <div className="hidden border-r border-line md:flex">
          {sidebar(() => setSidebarOpen(false))}
        </div>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/25"
          />
          {/* On mobile the same button dismisses the drawer rather than
              collapsing the desktop sidebar the person can't currently see. */}
          <div className="absolute inset-y-0 left-0 shadow-xl">
            {sidebar(() => setDrawerOpen(false))}
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Across the top of the conversation, not tucked into the thread: if
            the database can't keep what you write, that outranks the chat. */}
        {storeFault && (
          <div
            role="alert"
            className="flex shrink-0 items-start gap-2.5 border-b border-accent/40 bg-accent/8 px-4 py-2.5 text-base"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2.2} />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{storeFault.title}</span>
              {storeFault.detail && (
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                  {storeFault.detail}
                </span>
              )}
            </span>
            <button
              onClick={() => setStoreFault(null)}
              aria-label="Dismiss"
              className="shrink-0 rounded-md px-2 py-0.5 text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        )}

        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Show menu"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-panel hover:text-ink md:hidden"
          >
            <PanelLeft className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>

          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Show sidebar"
              className="hidden rounded-md p-1.5 text-muted transition-colors hover:bg-panel hover:text-ink md:block"
            >
              <PanelLeft className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          )}

          <span
            className={`min-w-0 flex-1 truncate text-base ${
              mode === "code" || activeTitle ? "font-medium" : "text-soft"
            }`}
          >
            {mode === "code" ? "Code" : activeTitle || "New chat"}
          </span>

          <button
            onClick={newChat}
            aria-label="New chat"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-panel hover:text-ink md:hidden"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </button>
        </header>

        {mode === "code" ? (
          <Build />
        ) : (
          <>
            <div
              ref={threadRef}
              onScroll={onThreadScroll}
              role="log"
              aria-label="Conversation"
              className="thin-scrollbar relative flex-1 overflow-y-auto"
            >
              <div className="thread-col px-4" style={{ paddingBlock: "var(--pad-y)" }}>
                {loadingThread && messages.length === 0 ? (
                  /* The shape of a conversation, not the shape of an empty app.
                     Showing the "What are you working on?" screen here reads as
                     "your chat is gone", which is the opposite of true. */
                  <ThreadSkeleton />
                ) : messages.length === 0 ? (
                  <div className="pt-[11vh]">
                    <Logo size={32} />
                    <p className="mt-1 text-sm font-medium text-soft">{modeLabel(settings)}</p>
                    <p className="mt-1.5 text-md text-muted">
                      {settings.callMe ? `What are you working on, ${settings.callMe}?` : "What are you working on?"}
                    </p>

                    <div className="mt-7 flex flex-wrap gap-2">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => send(s)}
                          className="rounded-full border border-line bg-surface px-3.5 py-2 text-base text-muted transition-colors hover:border-soft hover:text-ink"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="stack-msg">
                    {messages.map((m, i) => {
                      const last = i === messages.length - 1;
                      return (
                        <Message
                          key={i}
                          message={m}
                          streaming={streaming && last && m.role === "selflight"}
                          onRegenerate={
                            last && m.role === "selflight" && !streaming ? retry : undefined
                          }
                          editing={editingAt === i}
                          onStartEdit={
                            m.role === "user" && !streaming ? () => setEditingAt(i) : undefined
                          }
                          onEdit={
                            m.role === "user" && !streaming ? (text) => editMessage(i, text) : undefined
                          }
                          onCancelEdit={() => setEditingAt(null)}
                          options={settings}
                        />
                      );
                    })}

                    {/* Activity used to live here as its own line. It's now a
                        line inside the reply's thought process, so what the
                        model is doing and what it's thinking read as one thing.
                        This stays only for the moment before the first token,
                        when there's no reply to put it in yet. */}
                    {activity && !messages.at(-1)?.thinking && (
                      <div className="flex items-center gap-2 text-base text-muted">
                        <ActivityIcon className="h-3.5 w-3.5 animate-pulse" strokeWidth={2} />
                        {activity.label}…
                      </div>
                    )}

                    {notice && (
                      <div className="flex items-start gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-muted">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                        <span>{notice}</span>
                      </div>
                    )}

                    {error && (
                      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base text-muted">
                        <span className="flex-1">{error}</span>
                        <button
                          onClick={retry}
                          className="flex shrink-0 items-center gap-1.5 font-medium text-ink hover:text-accent"
                        >
                          <RotateCw className="h-3.5 w-3.5" strokeWidth={2.2} />
                          Retry
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="relative">
              {!pinned && messages.length > 0 && (
                <button
                  onClick={jumpToLatest}
                  aria-label="Jump to latest"
                  className="rise absolute -top-11 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-md transition-colors hover:text-ink"
                >
                  <ArrowDown className="h-4 w-4" strokeWidth={2.2} />
                </button>
              )}

              {/* What the composer did instead of sending, with both ways out
                  of it: put it back, or send it as a message after all. The
                  second is what makes reading a message as a command safe —
                  a wrong guess costs one press rather than the question. */}
              {command && (
                <div className="rise thread-col flex items-center gap-2 px-4 pb-1.5 text-sm">
                  <Wand2 className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} />
                  <span className="min-w-0 flex-1 truncate text-muted">{command.say}</span>
                  {command.before && (
                    <button
                      onClick={undoCommand}
                      className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-muted transition-colors hover:text-ink"
                    >
                      Undo
                    </button>
                  )}
                  {/* Only when there's something to send — this bar also
                      carries the result of coming back from a sign-in, which
                      was never a message. */}
                  {command.text && (
                    <button
                      onClick={sendAnyway}
                      className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-muted transition-colors hover:text-ink"
                    >
                      Send as a message
                    </button>
                  )}
                </div>
              )}

              <Composer
                value={input}
                onChange={setInput}
                onSend={() => send()}
                onStop={stop}
                streaming={streaming}
                settings={settings}
                onSettings={updateSettings}
                connectorCount={enabledConnectors}
                canTranscribe={can.transcribe}
                focusSignal={focusSignal}
                attachments={attachments}
                onAttach={setAttachments}
              />
            </div>
          </>
        )}
      </main>

      {section && (
        <div className="fixed inset-0 z-50 bg-page md:static md:z-auto md:shrink-0">
          <RightPanel
            section={section}
            settingsTab={settingsTab}
            onSettingsTab={setSettingsTab}
            onClose={closePanel}
            artifacts={artifacts}
            settings={settings}
            onSettings={updateSettings}
            connectors={connectorApi}
            themes={themes}
            palette={paletteApi}
          />
        </div>
      )}
    </div>
  );
}

// What a conversation looks like before it's arrived.
//
// Deliberately not a spinner: a spinner says "something is happening", while
// this says "your messages are on their way, and here is roughly where they'll
// be" — so the layout doesn't jump when they land. Two bars for the question,
// four for the reply, at the widths real text tends to run.
function ThreadSkeleton() {
  const line = (width, extra = "") => (
    <div className={`h-3.5 rounded-md bg-line/70 ${extra}`} style={{ width }} />
  );

  return (
    <div className="stack-msg" aria-busy="true" aria-label="Loading this conversation">
      <div className="flex justify-end">
        <div className="w-[55%] space-y-2 rounded-2xl rounded-br-md bg-panel px-4 py-3">
          {line("100%")}
          {line("62%")}
        </div>
      </div>
      <div className="space-y-2.5">
        {line("94%")}
        {line("100%")}
        {line("88%")}
        {line("46%")}
      </div>
    </div>
  );
}
