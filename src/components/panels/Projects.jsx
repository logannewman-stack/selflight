import React, { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { MAX_INSTRUCTIONS } from "../../lib/storage.js";

// A project is a folder with a memory.
//
// The instructions box is the whole point of the feature, so it's the biggest
// thing on the screen and everything else is arranged around it. People were
// already pasting the same three paragraphs at the top of every chat; this is
// that, said once.

export default function Projects({
  projects,
  chats,
  activeProjectId,
  onOpen,
  onCreate,
  onUpdate,
  onDelete,
  onNewChat
}) {
  const project = projects.find((p) => p.id === activeProjectId) || null;

  if (!project) {
    return (
      <List projects={projects} chats={chats} onOpen={onOpen} onCreate={onCreate} />
    );
  }

  return (
    <Detail
      project={project}
      chats={chats.filter((c) => c.projectId === project.id)}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onNewChat={onNewChat}
      onBack={() => onOpen(null)}
    />
  );
}

function List({ projects, chats, onOpen, onCreate }) {
  const [name, setName] = useState("");

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    onCreate(clean);
    setName("");
  };

  return (
    <div className="space-y-4">
      <p className="text-base leading-relaxed text-muted">
        A project keeps its own instructions, and every chat inside it answers with them. Useful
        for the context you'd otherwise retype at the top of each conversation.
      </p>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="Name a new project"
          aria-label="New project name"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-base outline-none placeholder:text-soft focus:border-soft"
        />
        <button
          onClick={create}
          disabled={!name.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-page transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
          Create
        </button>
      </div>

      {projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-soft">
          No projects yet.
        </p>
      ) : (
        <div className="space-y-2">
          {projects.map((project) => {
            const count = chats.filter((c) => c.projectId === project.id).length;
            return (
              <button
                key={project.id}
                onClick={() => onOpen(project.id)}
                className="flex w-full items-start gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-soft"
              >
                <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-soft" strokeWidth={2} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">{project.name}</span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {count === 1 ? "1 chat" : `${count} chats`}
                    {project.instructions ? " · has instructions" : " · no instructions yet"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Detail({ project, chats, onUpdate, onDelete, onNewChat, onBack }) {
  const [name, setName] = useState(project.name);
  const [instructions, setInstructions] = useState(project.instructions || "");
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef(null);

  // Switching projects while this is mounted has to reload the fields, or you'd
  // edit one project's instructions into another.
  useEffect(() => {
    setName(project.name);
    setInstructions(project.instructions || "");
    setConfirming(false);
  }, [project.id]);

  // Saved as you type, with a moment's pause, and a confirmation that says so.
  // A Save button on a box this size is a way to lose an afternoon's context by
  // navigating away.
  useEffect(() => {
    if (name === project.name && instructions === (project.instructions || "")) return;

    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onUpdate(project.id, { name: name.trim() || "Untitled project", instructions });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    }, 600);

    return () => clearTimeout(timer.current);
  }, [name, instructions, project.id, project.name, project.instructions, onUpdate]);

  const room = MAX_INSTRUCTIONS - instructions.length;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm font-medium text-muted hover:text-ink">
        ← All projects
      </button>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Project name"
        className="w-full rounded-lg border border-transparent bg-transparent px-0 py-1 text-xl font-semibold outline-none focus:border-line focus:px-2"
      />

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor="project-instructions" className="text-base font-medium">
            Instructions
          </label>
          <span className="text-2xs text-soft">
            {saved ? "Saved" : room < 400 ? `${room} characters left` : ""}
          </span>
        </div>
        <textarea
          id="project-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value.slice(0, MAX_INSTRUCTIONS))}
          rows={10}
          placeholder={
            "What should Selflight know in every chat here?\n\n" +
            "Who you are, what you're working on, how you want answers. " +
            "It goes into the system prompt for this project's conversations, " +
            "and takes precedence over your account-wide instructions."
          }
          className="thin-scrollbar w-full resize-y rounded-xl border border-line bg-surface p-3 text-base leading-relaxed outline-none placeholder:text-soft focus:border-soft"
        />
      </div>

      <button
        onClick={() => onNewChat(project.id)}
        className="flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-page transition-opacity hover:opacity-90"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
        New chat in this project
      </button>

      <div>
        <p className="mb-1.5 text-base font-medium">
          {chats.length === 1 ? "1 conversation" : `${chats.length} conversations`}
        </p>
        {chats.length === 0 ? (
          <p className="text-sm text-soft">Nothing in here yet.</p>
        ) : (
          <div className="space-y-1">
            {chats.slice(0, 12).map((chat) => (
              <p key={chat.id} className="truncate text-sm text-muted">
                {chat.title}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-line pt-3">
        {confirming ? (
          <div className="flex items-center gap-2 text-sm">
            {/* Said plainly, because the obvious fear is that this takes the
                conversations with it. It doesn't. */}
            <span className="text-muted">
              Delete “{project.name}”? Its {chats.length === 1 ? "chat" : "chats"} will stay, just
              outside any project.
            </span>
            <button
              onClick={() => onDelete(project.id)}
              className="shrink-0 rounded-lg px-2 py-1 font-medium text-accent hover:bg-panel"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="shrink-0 rounded-lg px-2 py-1 font-medium text-muted hover:bg-panel"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-accent"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            Delete project
          </button>
        )}
      </div>
    </div>
  );
}
