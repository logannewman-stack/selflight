import React, { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeft, Plus, RotateCw } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Message from "./components/Message.jsx";
import Composer from "./components/Composer.jsx";
import { generateTitle, streamChat } from "./lib/api.js";
import {
  createChat,
  deleteChat,
  fallbackTitle,
  listChats,
  renameChat,
  saveMessages
} from "./lib/storage.js";

const SUGGESTIONS = [
  "Explain something I'm stuck on",
  "Help me write a hard email",
  "Think through a decision with me",
  "Find the flaw in this plan"
];

export default function App() {
  const [chats, setChats] = useState(() => listChats());
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const threadRef = useRef(null);
  const abortRef = useRef(null);
  // The turn in flight writes to whichever chat it started in, so switching
  // chats mid-stream can't drop a reply into the wrong conversation.
  const chatIdRef = useRef(null);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, streaming]);

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
    setStreaming(false);
    setDrawerOpen(false);
  }, [stop]);

  const openChat = useCallback(
    (chat) => {
      stop();
      chatIdRef.current = chat.id;
      setActiveId(chat.id);
      setMessages(chat.messages || []);
      setError(null);
      setStreaming(false);
      setDrawerOpen(false);
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

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setDrawerOpen(false);
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
    setStreaming(true);
    if (isCurrent()) setMessages([...base, { role: "selflight", text: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;

    let acc = "";
    let failed = null;

    try {
      await streamChat(base, {
        signal: controller.signal,
        onText: (chunk) => {
          acc += chunk;
          if (isCurrent()) setMessages([...base, { role: "selflight", text: acc }]);
        }
      });
    } catch (err) {
      // A stop button press is a normal ending, not a failure.
      if (err.name !== "AbortError") failed = err;
    }

    const final = acc ? [...base, { role: "selflight", text: acc }] : base;

    setStreaming(false);
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

  const sidebar = (onCollapse) => (
    <Sidebar
      chats={chats}
      activeId={activeId}
      onNew={newChat}
      onOpen={openChat}
      onDelete={removeChat}
      onCollapse={onCollapse}
    />
  );

  const activeTitle = chats.find((c) => c.id === activeId)?.title;

  return (
    <div className="flex h-full overflow-hidden">
      {sidebarOpen && <div className="hidden md:flex">{sidebar(() => setSidebarOpen(false))}</div>}

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/20"
          />
          {/* On mobile the same button dismisses the drawer rather than
              collapsing the desktop sidebar the person can't currently see. */}
          <div className="absolute inset-y-0 left-0 shadow-xl">
            {sidebar(() => setDrawerOpen(false))}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Show chats"
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
            className={`min-w-0 flex-1 truncate text-[14px] ${
              activeTitle ? "font-medium" : "text-soft"
            }`}
          >
            {activeTitle || "New chat"}
          </span>

          <button
            onClick={newChat}
            aria-label="New chat"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-panel hover:text-ink md:hidden"
          >
            <Plus className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </button>
        </header>

        <div ref={threadRef} className="no-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[720px] px-4 py-6">
            {messages.length === 0 ? (
              <div className="pt-[12vh]">
                <h1 className="text-[26px] font-semibold tracking-[-0.5px]">Selflight</h1>
                <p className="mt-1.5 text-[15px] text-muted">What are you working on?</p>

                <div className="mt-7 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-line bg-white px-3.5 py-2 text-[13.5px] text-muted transition-colors hover:border-soft hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((m, i) => (
                  <Message
                    key={i}
                    message={m}
                    streaming={streaming && i === messages.length - 1 && m.role === "selflight"}
                  />
                ))}

                {error && (
                  <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13.5px] text-muted">
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

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => send()}
          onStop={stop}
          streaming={streaming}
        />
      </div>
    </div>
  );
}
