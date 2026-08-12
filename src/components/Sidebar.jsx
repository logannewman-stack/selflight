import React, { useState } from "react";
import {
  Code2,
  Home,
  Link2,
  Palette,
  PanelLeft,
  Plus,
  Search,
  Shapes,
  SlidersHorizontal,
  Trash2
} from "lucide-react";

export default function Sidebar({
  chats,
  activeId,
  mode,
  onMode,
  section,
  onSection,
  artifactCount,
  name,
  onNew,
  onOpen,
  onDelete,
  onCollapse
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const shown = query.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))
    : chats;

  return (
    <div className="flex h-full w-[248px] shrink-0 flex-col bg-panel">
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="text-[15px] font-semibold tracking-[-0.2px]">Selflight</span>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Search chats"
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

      {searching && (
        <div className="px-3 pt-2.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearching(false)}
            placeholder="Search chats"
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none placeholder:text-soft focus:border-soft"
          />
        </div>
      )}

      <nav className="px-2 pt-2.5">
        <NavItem icon={Plus} label="New" onClick={onNew} strong />
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
          active={section === "connectors"}
          onClick={() => onSection("connectors")}
        />
        <NavItem
          icon={SlidersHorizontal}
          label="Customize"
          active={section === "customize"}
          onClick={() => onSection("customize")}
        />
        <NavItem
          icon={Palette}
          label="Design"
          active={section === "design"}
          onClick={() => onSection("design")}
        />
      </nav>

      <div className="thin-scrollbar mt-4 flex-1 overflow-y-auto px-3 pb-4">
        <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-soft">
          Recents
        </p>

        {shown.length === 0 && (
          <p className="px-2 pt-1 text-[12.5px] leading-relaxed text-soft">
            {chats.length === 0 ? "Your chats will show up here." : "No chats match that."}
          </p>
        )}

        {shown.map((chat) => {
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
                className="flex min-w-0 flex-1 items-center gap-2 py-[7px] pl-2.5 text-left"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
                />
                <span
                  className={`truncate text-[13px] ${active ? "font-medium text-ink" : "text-muted"}`}
                >
                  {chat.title}
                </span>
              </button>

              {confirming === chat.id ? (
                <div className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold">
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

      <div className="flex items-center gap-2.5 border-t border-line px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-page">
          {(name || "You").slice(0, 2).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{name || "You"}</span>
      </div>
    </div>
  );
}

function Segment({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-1.5 text-[13px] font-medium transition-colors ${
        active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
      {label}
    </button>
  );
}

function NavItem({ icon: Icon, label, onClick, active, badge, strong }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13.5px] transition-colors ${
        active ? "bg-surface font-medium text-ink" : "text-muted hover:bg-surface/60 hover:text-ink"
      } ${strong ? "font-medium text-ink" : ""}`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-page">
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
