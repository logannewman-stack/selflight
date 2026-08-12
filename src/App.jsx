import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Globe, Info, Link2, PanelLeft, Plus, RotateCw, Search, Sparkles } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Message from "./components/Message.jsx";
import Composer from "./components/Composer.jsx";
import RightPanel from "./components/RightPanel.jsx";
import Build from "./components/panels/Build.jsx";
import { generateTitle, streamChat } from "./lib/api.js";
import { extractArtifacts } from "./lib/artifacts.js";
import { BUILT_IN_THEMES, applyFonts, applyTheme, resolvePalette } from "./lib/themes.js";
import * as fontCatalogue from "./lib/fonts.js";
import {
  deletePalette,
  draftFrom,
  importPalette,
  listPalettes,
  refreshSwatch,
  savePalette
} from "./lib/palettes.js";
import {
  addConnector,
  createChat,
  deleteChat,
  fallbackTitle,
  listChats,
  listConnectors,
  loadSettings,
  removeConnector,
  renameChat,
  saveMessages,
  saveSettings,
  updateConnector
} from "./lib/storage.js";

const SUGGESTIONS = [
  "Explain something I'm stuck on",
  "What changed in the news today?",
  "Think through a decision with me",
  "Find the flaw in this plan"
];

const ACTIVITY_ICONS = { search: Search, fetch: Globe, connector: Link2, tool: Sparkles };

export default function App() {
  const [chats, setChats] = useState(() => listChats());
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [activity, setActivity] = useState(null);

  const [settings, setSettings] = useState(() => loadSettings());
  const [connectors, setConnectors] = useState(() => listConnectors());
  const [palettes, setPalettes] = useState(() => listPalettes());
  // An unsaved palette being edited. While set, it previews over the real theme.
  const [draft, setDraft] = useState(null);

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

  const artifacts = useMemo(() => extractArtifacts(messages), [messages]);

  const themes = useMemo(() => [...BUILT_IN_THEMES, ...palettes], [palettes]);

  useEffect(() => {
    applyTheme(settings, { prefersDark, themes, override: draft });
    saveSettings(settings);
  }, [settings, prefersDark, themes, draft]);

  useEffect(() => {
    applyFonts(settings, fontCatalogue);
  }, [settings.uiFont, settings.replyFont, settings.codeFont]);

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
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
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
    setError(null);
    setNotice(null);
    setStreaming(false);
    setMode("chat");
    setDrawerOpen(false);
    setPinned(true);
    setFocusSignal((n) => n + 1);
  }, [stop]);

  const openChat = useCallback(
    (chat) => {
      stop();
      chatIdRef.current = chat.id;
      setActiveId(chat.id);
      setMessages(chat.messages || []);
      setError(null);
      setNotice(null);
      setStreaming(false);
      setMode("chat");
      setDrawerOpen(false);
      setPinned(true);
      setFocusSignal((n) => n + 1);
    },
    [stop]
  );

  const removeChat = useCallback(
    (id) => {
      deleteChat(id);
      setChats(listChats());
      if (chatIdRef.current === id) newChat();
    },
    [newChat]
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
    let failed = null;

    try {
      await streamChat(base, {
        signal: controller.signal,
        settings,
        connectors,
        onActivity: (next) => isCurrent() && setActivity(next),
        onNotice: (text) => isCurrent() && setNotice(text),
        onText: (chunk) => {
          acc += chunk;
          if (isCurrent()) {
            setActivity(null);
            setMessages([...base, { role: "selflight", text: acc }]);
          }
        }
      });
    } catch (err) {
      // A stop button press is a normal ending, not a failure.
      if (err.name !== "AbortError") failed = err;
    }

    const final = acc ? [...base, { role: "selflight", text: acc }] : base;

    setStreaming(false);
    setActivity(null);
    abortRef.current = null;

    if (isCurrent()) {
      setMessages(final);
      if (failed) setError(failed.message);
    }

    saveMessages(chatId, final);
    setChats(listChats());
    return { final, failed };
  };

  const send = async (raw) => {
    const text = (raw ?? input).trim();
    if (!text || streaming) return;

    const base = [...messages, { role: "user", text }];
    setInput("");

    let chatId = chatIdRef.current;
    const isNew = !chatId;

    if (isNew) {
      // Save the user's turn before the model answers, so a refresh mid-reply
      // still leaves the question in history.
      const chat = createChat({ title: fallbackTitle(text), messages: base });
      chatId = chat.id;
      chatIdRef.current = chatId;
      setActiveId(chatId);
    } else {
      saveMessages(chatId, base);
    }
    setChats(listChats());

    const { final, failed } = await runTurn(base, chatId);

    if (isNew && !failed) {
      const title = await generateTitle(final);
      if (title) {
        renameChat(chatId, title);
        setChats(listChats());
      }
    }
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

    save: () => {
      const saved = savePalette(refreshSwatch(draft));
      setPalettes(listPalettes());
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

    remove: () => {
      const id = draft.id;
      deletePalette(id);
      setPalettes(listPalettes());
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

    import: (text) => {
      try {
        const imported = importPalette(text, resolvePalette(settings, prefersDark, themes));
        const saved = savePalette(imported);
        setPalettes(listPalettes());
        selectPalette(saved);
        return null;
      } catch (err) {
        return err.message;
      }
    }
  };

  const connectorApi = {
    items: connectors,
    add: (data) => {
      addConnector(data);
      setConnectors(listConnectors());
    },
    update: (id, fields) => {
      updateConnector(id, fields);
      setConnectors(listConnectors());
    },
    remove: (id) => {
      removeConnector(id);
      setConnectors(listConnectors());
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
      onNew={newChat}
      onOpen={openChat}
      onDelete={removeChat}
      onCollapse={onCollapse}
    />
  );

  const activeTitle = chats.find((c) => c.id === activeId)?.title;
  const ActivityIcon = activity ? ACTIVITY_ICONS[activity.kind] || Sparkles : null;
  const enabledConnectors = connectors.filter((c) => c.enabled).length;

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
              className="thin-scrollbar relative flex-1 overflow-y-auto"
            >
              <div className="thread-col px-4" style={{ paddingBlock: "var(--pad-y)" }}>
                {messages.length === 0 ? (
                  <div className="pt-[11vh]">
                    <h1 className="font-serif text-3xl font-normal tracking-[-0.02em]">Selflight</h1>
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
                          options={settings}
                        />
                      );
                    })}

                    {activity && (
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

              <Composer
                value={input}
                onChange={setInput}
                onSend={() => send()}
                onStop={stop}
                streaming={streaming}
                settings={settings}
                connectorCount={enabledConnectors}
                focusSignal={focusSignal}
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
