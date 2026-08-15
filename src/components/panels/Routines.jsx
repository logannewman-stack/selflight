import React, { useEffect, useState } from "react";
import { Check, Clock, Loader2, Play, Plus, Trash2, X } from "lucide-react";
import {
  CADENCES,
  DAYS,
  describe,
  localZone,
  parseTime,
  timeLabel,
  whenLabel
} from "../../lib/schedule.js";

// Routines: a question on a timer, with somewhere for the answer to go.
//
// Three fields, in the order you'd say them out loud — when, what, where — and
// a sentence underneath that reads back what you've built. Not a canvas of
// nodes and wires: almost everything people actually want from one of those is
// "ask this every morning and send it to me", and a canvas makes that a
// twenty-minute job for someone who already knows what a webhook is.

const BLANK = {
  name: "",
  prompt: "",
  every: "weekday",
  atMinute: 480,
  weekday: 1,
  dayOfMonth: 1,
  zone: localZone(),
  deliver: ["chat"],
  email: "",
  webhook: "",
  enabled: true,
  projectId: null
};

export default function Routines({
  routines,
  runs,
  projects,
  signedIn,
  busy,
  error,
  onCreate,
  onUpdate,
  onDelete,
  onRun,
  onOpenChat
}) {
  const [editing, setEditing] = useState(null);

  if (!signedIn) {
    return (
      <div className="space-y-3">
        <p className="text-base leading-relaxed text-muted">
          A routine runs while you're not here, so it needs somewhere to run from and somewhere to
          put the answer. That means an account.
        </p>
        <p className="text-sm leading-relaxed text-soft">
          Sign in and this page fills up. Nothing else about Polstar needs one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-base leading-relaxed text-muted">
        Ask something on a schedule and have the answer waiting. A morning briefing, a Monday
        summary, a check on something you'd otherwise forget.
      </p>

      {error && (
        <p role="alert" className="rounded-lg border border-accent/40 bg-accent/8 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {editing ? (
        <Editor
          draft={editing}
          projects={projects}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (routine) => {
            const ok = routine.id ? await onUpdate(routine.id, routine) : await onCreate(routine);
            if (ok) setEditing(null);
          }}
        />
      ) : (
        <button
          onClick={() => setEditing({ ...BLANK })}
          className="flex items-center gap-2 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-page transition-opacity hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
          New routine
        </button>
      )}

      {routines.length === 0 && !editing ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-soft">
          No routines yet.
        </p>
      ) : (
        <div className="space-y-2">
          {routines.map((routine) => (
            <Row
              key={routine.id}
              routine={routine}
              runs={runs.filter((r) => r.routineId === routine.id)}
              busy={busy}
              onEdit={() => setEditing({ ...routine })}
              onToggle={() => onUpdate(routine.id, { enabled: !routine.enabled })}
              onDelete={() => onDelete(routine.id)}
              onRun={() => onRun(routine.id)}
              onOpenChat={onOpenChat}
            />
          ))}
        </div>
      )}

      {routines.length > 0 && (
        // Said once, plainly, rather than discovered. The sweep is every fifteen
        // minutes, so a routine set for 08:07 starts at 08:15 — small, but the
        // sort of thing that reads as broken if nobody mentioned it.
        <p className="text-xs leading-relaxed text-soft">
          Routines are checked every 15 minutes, so one may start up to 15 minutes after the time
          you pick. Times are in {routines[0]?.zone || localZone()}.
        </p>
      )}
    </div>
  );
}

/* ---------------------------------- a row --------------------------------- */

function Row({ routine, runs, busy, onEdit, onToggle, onDelete, onRun, onOpenChat }) {
  const [confirming, setConfirming] = useState(false);
  const last = runs[0];

  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-2">
            <span className="truncate text-base font-medium">{routine.name}</span>
            {!routine.enabled && (
              <span className="shrink-0 rounded-full border border-line bg-surface px-1.5 py-0.5 text-2xs font-bold uppercase text-muted">
                Paused
              </span>
            )}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{describe(routine)}</span>
            <span className="text-soft">·</span>
            <span className="text-soft">
              {routine.enabled
                ? `next ${whenLabel(routine.nextRunAt, routine.zone)}`
                : "not scheduled"}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="Run now" onClick={onRun} disabled={busy}>
            {busy === routine.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Play className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </IconButton>
          <IconButton
            label={routine.enabled ? "Pause" : "Resume"}
            onClick={onToggle}
            active={routine.enabled}
          >
            <Clock className="h-3.5 w-3.5" strokeWidth={2} />
          </IconButton>
          {confirming ? (
            <>
              <button
                onClick={onDelete}
                className="rounded-md px-1.5 py-1 text-xs font-semibold text-accent hover:bg-panel"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-md px-1.5 py-1 text-xs font-semibold text-muted hover:bg-panel"
              >
                No
              </button>
            </>
          ) : (
            <IconButton label="Delete" onClick={() => setConfirming(true)}>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            </IconButton>
          )}
        </div>
      </div>

      {/* What happened last time. A routine that quietly stopped working is the
          failure worth being able to see without going to a database. */}
      {last && (
        <button
          onClick={() => last.chatId && onOpenChat(last.chatId)}
          disabled={!last.chatId}
          className={`flex w-full items-start gap-2 border-t border-line px-3 py-2 text-left text-sm ${
            last.chatId ? "transition-colors hover:bg-panel/60" : ""
          }`}
        >
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
              last.status === "ok" ? "bg-accent" : "bg-soft"
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-muted">
              {last.status === "ok" ? last.summary || "Ran." : last.summary || "Didn't run."}
            </span>
            {last.detail && <span className="block truncate text-soft">{last.detail}</span>}
          </span>
          <span className="shrink-0 text-2xs text-soft">
            {whenLabel(last.at, routine.zone) === "due now"
              ? "just now"
              : new Date(last.at).toLocaleDateString()}
          </span>
        </button>
      )}
    </div>
  );
}

/* --------------------------------- the form ------------------------------- */

function Editor({ draft, projects, busy, onSave, onCancel }) {
  const [routine, setRoutine] = useState(draft);
  const set = (patch) => setRoutine((r) => ({ ...r, ...patch }));
  const [time, setTime] = useState(timeLabel(draft.atMinute));

  useEffect(() => {
    const minutes = parseTime(time);
    if (minutes !== null) set({ atMinute: minutes });
  }, [time]);

  const cadence = CADENCES.find((c) => c.id === routine.every) || CADENCES[1];
  const has = (channel) => routine.deliver.includes(channel);

  const toggle = (channel) =>
    set({
      deliver: has(channel)
        ? routine.deliver.filter((c) => c !== channel)
        : [...routine.deliver, channel]
    });

  return (
    <div className="space-y-3.5 rounded-xl border border-accent/40 bg-surface p-3">
      <Field label="Call it">
        <input
          value={routine.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Morning briefing"
          aria-label="Routine name"
          className="w-full rounded-lg border border-line bg-page px-2.5 py-1.5 text-base outline-none placeholder:text-soft focus:border-soft"
        />
      </Field>

      {/* When, what, where — in the order you'd say them. */}
      <Field label="When">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={routine.every}
            onChange={(e) => set({ every: e.target.value })}
            aria-label="How often"
            className="rounded-lg border border-line bg-page px-2 py-1.5 text-base outline-none focus:border-soft"
          >
            {CADENCES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {cadence.needs.includes("weekday") && (
            <select
              value={routine.weekday}
              onChange={(e) => set({ weekday: Number(e.target.value) })}
              aria-label="Which day"
              className="rounded-lg border border-line bg-page px-2 py-1.5 text-base outline-none focus:border-soft"
            >
              {DAYS.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          )}

          {cadence.needs.includes("day") && (
            <select
              value={routine.dayOfMonth}
              onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}
              aria-label="Day of the month"
              className="rounded-lg border border-line bg-page px-2 py-1.5 text-base outline-none focus:border-soft"
            >
              {/* 1–28 only, so a monthly routine never skips February. */}
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}

          {cadence.needs.includes("time") && (
            <input
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="08:00"
              aria-label="Time"
              className="w-20 rounded-lg border border-line bg-page px-2 py-1.5 text-base tabular-nums outline-none focus:border-soft"
            />
          )}
        </div>
      </Field>

      <Field label="Ask">
        <textarea
          value={routine.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          rows={3}
          placeholder="What happened in AI overnight? Three bullets, plainly, with links."
          aria-label="What to ask"
          className="thin-scrollbar w-full resize-y rounded-lg border border-line bg-page p-2.5 text-base leading-relaxed outline-none placeholder:text-soft focus:border-soft"
        />
      </Field>

      {projects.length > 0 && (
        <Field label="In project">
          <select
            value={routine.projectId || ""}
            onChange={(e) => set({ projectId: e.target.value || null })}
            aria-label="Project"
            className="w-full rounded-lg border border-line bg-page px-2 py-1.5 text-base outline-none focus:border-soft"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Send it to">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {[
              ["chat", "A new chat"],
              ["email", "Email"],
              ["webhook", "A webhook"]
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => toggle(id)}
                aria-pressed={has(id)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium transition-colors ${
                  has(id) ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:border-soft"
                }`}
              >
                {has(id) && <Check className="h-3 w-3" strokeWidth={3} />}
                {label}
              </button>
            ))}
          </div>

          {has("email") && (
            <input
              value={routine.email}
              onChange={(e) => set({ email: e.target.value })}
              placeholder="you@example.com"
              aria-label="Email address"
              className="w-full rounded-lg border border-line bg-page px-2.5 py-1.5 text-base outline-none placeholder:text-soft focus:border-soft"
            />
          )}
          {has("webhook") && (
            <input
              value={routine.webhook}
              onChange={(e) => set({ webhook: e.target.value })}
              placeholder="https://…"
              aria-label="Webhook URL"
              className="w-full rounded-lg border border-line bg-page px-2.5 py-1.5 text-base outline-none placeholder:text-soft focus:border-soft"
            />
          )}
        </div>
      </Field>

      {/* The routine read back as a sentence. "every: week, weekday: 2,
          at_minute: 540" is a database row; this is something you can check at
          a glance and notice is wrong. */}
      <p className="rounded-lg bg-panel px-2.5 py-2 text-sm leading-relaxed text-muted">
        {describe(routine)}, ask{" "}
        <span className="text-ink">{routine.prompt.trim() ? `“${clip(routine.prompt)}”` : "…"}</span>
        {routine.deliver.length ? ` and send it to ${listOf(routine)}.` : " — and send it nowhere."}
      </p>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave(routine)}
          disabled={busy === true}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-page transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {routine.id ? "Save" : "Create routine"}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-muted hover:text-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          Cancel
        </button>
      </div>
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

function Field({ label, children }) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold uppercase tracking-[0.08em] text-soft">{label}</p>
      {children}
    </div>
  );
}

function IconButton({ children, onClick, label, disabled, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded-md p-1.5 transition-colors hover:bg-panel hover:text-ink disabled:opacity-40 ${
        active ? "text-accent" : "text-soft"
      }`}
    >
      {children}
    </button>
  );
}

function clip(text, width = 60) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > width ? `${clean.slice(0, width).trimEnd()}…` : clean;
}

function listOf(routine) {
  const names = routine.deliver.map((c) =>
    c === "chat" ? "a new chat" : c === "email" ? routine.email || "email" : "your webhook"
  );
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
