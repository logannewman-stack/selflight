import React, { useEffect, useRef, useState } from "react";
import {
  Code2,
  Home,
  Link2,
  LogOut,
  PanelLeft,
  Plus,
  Search,
  Shapes,
  SlidersHorizontal,
  Trash2
} from "lucide-react";
import Logo from "./Logo.jsx";

const DAY = 86400000;

function groupByDate(chats) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets = [
    ["Today", today],
    ["Yesterday", today - DAY],
    ["Previous 7 days", today - 7 * DAY],
    ["Earlier", -Infinity]
  ];

  const grouped = buckets.map(([label]) => [label, []]);
  for (const chat of chats) {
    const at = chat.updatedAt || 0;
    const index = buckets.findIndex(([, floor]) => at >= floor);
    grouped[index === -1 ? grouped.length - 1 : index][1].push(chat);
  }
  return grouped.filter(([, list]) => list.length);
}

export default function Sidebar({
  chats,
  activeId,
  mode,
  onMode,
  section,
  onSection,
  artifactCount,
  connectorCount,
  settingsTab,
  name,
  email,
  onSignOut,
  onNew,
  onOpen,
  onPrefetch,
  onDelete,
  onCollapse
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const filtered = query.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))
    : chats;
  const groups = query.trim() ? [["Results", filtered]] : groupByDate(filtered);

  return (
    <div className="flex h-full w-[252px] shrink-0 flex-col bg-panel">
      <div className="flex items-center justify-between px-4 pt-4">
        <Logo size={21} />
        <div className="flex items-center gap-0.5">
          <IconButton
            label={searching ? "Close search" : "Search chats"}
            onClick={() => {
              setSearching((s) => !s);
              setQuery("");
            }}
          >
            <Search className="h-4 w-4" strokeWidth={2} />
          </IconButton>
          <IconButton label="Hide sidebar" onClick={onCollapse}>
            <PanelLeft className="h-4 w-4" strokeWidth={2} />
          </IconButton>
        </div>
      </div>

      <div className="px-3 pt-3.5">
        <div className="flex rounded-xl bg-line/60 p-0.5">
          <Segment icon={Home} label="Home" active={mode === "chat"} onClick={() => onMode("chat")} />
          <Segment icon={Code2} label="Code" active={mode === "code"} onClick={() => onMode("code")} />
        </div>
      </div>

      <div className="px-3 pt-3">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-base font-medium transition-colors hover:border-soft"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          New chat
          <kbd className="ml-auto text-2xs font-normal text-soft">⌘K</kbd>
        </button>
      </div>

      {searching && (
        <div className="px-3 pt-2.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearching(false)}
            placeholder="Search chats"
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-base outline-none placeholder:text-soft focus:border-soft"
          />
        </div>
      )}

      <nav className="px-2 pt-2.5">
        <NavItem
          icon={Shapes}
          label="Artifacts"
          badge={artifactCount || null}
          active={section === "artifacts"}
          onClick={() => onSection("artifacts")}
        />
        <NavItem
          icon={Link2}
          label="Connectors"
          badge={connectorCount || null}
          active={section === "settings" && settingsTab === "connectors"}
          onClick={() => onSection("settings", "connectors")}
        />
      </nav>

      <div className="thin-scrollbar mt-3.5 flex-1 overflow-y-auto px-3 pb-4">
        {filtered.length === 0 && (
          <p className="px-2 pt-1 text-sm leading-relaxed text-soft">
            {chats.length === 0 ? "Your chats will show up here." : "No chats match that."}
          </p>
        )}

        {groups.map(([label, list]) => (
          <div key={label} className="mb-3 last:mb-0">
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-[0.1em] text-soft">
              {label}
            </p>
            {list.map((chat) => {
              const active = chat.id === activeId && mode === "chat";
              return (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                    active ? "bg-surface" : "hover:bg-surface/60"
                  }`}
                >
                  <button
                    onClick={() => onOpen(chat)}
                    // Start loading before the tap lands. On a mouse that's the
                    // ~200ms between hovering and clicking; on a touchscreen
                    // it's the whole duration of the press. Either is usually
                    // longer than the fetch, so the chat is already there.
                    onPointerEnter={() => onPrefetch?.(chat.id)}
                    onTouchStart={() => onPrefetch?.(chat.id)}
                    onFocus={() => onPrefetch?.(chat.id)}
                    className="row-y flex min-w-0 flex-1 items-center gap-2 pl-2.5 text-left"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
                    />
                    <span
                      className={`truncate text-base ${active ? "font-medium text-ink" : "text-muted"}`}
                    >
                      {chat.title}
                    </span>
                  </button>

                  {confirming === chat.id ? (
                    <div className="flex shrink-0 items-center gap-0.5 text-xs font-semibold">
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
        ))}
      </div>

      <div className="flex items-center gap-1 border-t border-line p-2">
        <button
          onClick={() => onSection("settings")}
          aria-label="Settings"
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors ${
            section === "settings" || section === "palette"
              ? "bg-surface"
              : "hover:bg-surface/60"
          }`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-2xs font-bold text-page">
            {(name || email || "You").slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name || email || "You"}</span>
            {/* Only worth a second line when it isn't already the first one. */}
            {email && name && <span className="block truncate text-2xs text-soft">{email}</span>}
          </span>
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-soft" strokeWidth={2} />
        </button>

        {onSignOut && (
          <IconButton label="Sign out" onClick={onSignOut}>
            <LogOut className="h-4 w-4" strokeWidth={2} />
          </IconButton>
        )}
      </div>
    </div>
  );
}


function Segment({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-1.5 text-base font-medium transition-colors ${
        active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
      {label}
    </button>
  );
}

function NavItem({ icon: Icon, label, onClick, active, badge }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-base transition-colors ${
        active ? "bg-surface font-medium text-ink" : "text-muted hover:bg-surface/60 hover:text-ink"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="rounded-full bg-line px-1.5 py-0.5 text-2xs font-bold text-muted">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function IconButton({ children, onClick, label }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
    >
      {children}
    </button>
  );
}
