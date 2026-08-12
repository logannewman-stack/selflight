import React, { useState } from "react";
import { PanelLeft, Plus, Search, Trash2 } from "lucide-react";

export default function Sidebar({ chats, activeId, onNew, onOpen, onDelete, onCollapse }) {
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(null);

  // Search only earns its space once the list is long enough to scan.
  const searchable = chats.length >= 6;
  const shown = searchable && query.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))
    : chats;

  return (
    <div className="flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="text-[15px] font-semibold tracking-[-0.2px]">Selflight</span>
        <button
          onClick={onCollapse}
          aria-label="Hide sidebar"
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-line hover:text-ink"
        >
          <PanelLeft className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <div className="px-3 pt-4">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-[14px] font-medium transition-colors hover:border-soft"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          New chat
        </button>
      </div>

      {searchable && (
        <div className="px-3 pt-3">
          <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 ring-line focus-within:ring-soft">
            <Search className="h-3.5 w-3.5 shrink-0 text-soft" strokeWidth={2.2} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-soft"
            />
          </div>
        </div>
      )}

      <div className="no-scrollbar mt-5 flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-soft">
          Recents
        </p>

        {shown.length === 0 && (
          <p className="px-2 pt-1 text-[13px] leading-relaxed text-soft">
            {chats.length === 0 ? "Your chats will show up here." : "No chats match that."}
          </p>
        )}

        {shown.map((chat) => {
          const active = chat.id === activeId;
          return (
            <div
              key={chat.id}
              className={`group flex items-center gap-2 rounded-lg pr-1 transition-colors ${
                active ? "bg-white" : "hover:bg-white/60"
              }`}
            >
              <button
                onClick={() => onOpen(chat)}
                className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 text-left"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    active ? "bg-accent" : "bg-transparent"
                  }`}
                />
                <span
                  className={`truncate text-[13.5px] ${
                    active ? "font-medium text-ink" : "text-muted"
                  }`}
                >
                  {chat.title}
                </span>
              </button>

              {confirming === chat.id ? (
                <div className="flex shrink-0 items-center gap-1 pr-1 text-[11px] font-semibold">
                  <button
                    onClick={() => {
                      onDelete(chat.id);
                      setConfirming(null);
                    }}
                    className="rounded px-1.5 py-1 text-accent hover:bg-line"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="rounded px-1.5 py-1 text-muted hover:bg-line"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(chat.id)}
                  aria-label={`Delete ${chat.title}`}
                  className="shrink-0 rounded-md p-1.5 text-soft opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="text-[11px] leading-relaxed text-soft">Chats are saved on this device.</p>
      </div>
    </div>
  );
}
