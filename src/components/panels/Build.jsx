import React, { useRef, useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { ArtifactToolbar, CodePane, Preview } from "../ArtifactView.jsx";
import { extractDocument } from "../../lib/artifacts.js";
import { streamBuild } from "../../lib/api.js";
import { Button } from "../ui.jsx";

const IDEAS = [
  "A pomodoro timer with a calm palette",
  "A landing page for a car detailing business",
  "A habit tracker with a 7-day grid",
  "A tip calculator that splits by person"
];

export default function Build() {
  const [prompt, setPrompt] = useState("");
  const [code, setCode] = useState("");
  const [draft, setDraft] = useState("");
  const [view, setView] = useState("preview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const run = async (instruction) => {
    const text = instruction.trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    setPrompt("");
    setView("code");

    // Send the current page back as context so follow-ups edit rather than restart.
    const history = code
      ? [
          { role: "user", text: "Build a page." },
          { role: "selflight", text: `\`\`\`html\n${code}\n\`\`\`` },
          { role: "user", text }
        ]
      : [{ role: "user", text }];

    const controller = new AbortController();
    abortRef.current = controller;

    let acc = "";
    try {
      await streamBuild(history, {
        signal: controller.signal,
        onText: (chunk) => {
          acc += chunk;
          setDraft(acc);
        }
      });

      const html = extractDocument(acc);
      if (html) {
        setCode(html);
        setView("preview");
      } else {
        setError("That reply didn't contain a page. Try describing it more concretely.");
      }
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    }

    setDraft("");
    setBusy(false);
    abortRef.current = null;
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  if (!code && !busy) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto px-5 py-8">
          <Wand2 className="mb-3 h-5 w-5 text-soft" strokeWidth={1.8} />
          <h2 className="text-lg font-semibold tracking-[-0.2px]">Build something</h2>
          <p className="mt-1.5 text-base leading-relaxed text-muted">
            Describe a page and Selflight writes it, runs it here, and keeps editing it as you ask
            for changes. Everything is one self-contained HTML file you can download.
          </p>

          <div className="mt-5 space-y-1.5">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                onClick={() => run(idea)}
                className="block w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-base text-muted transition-colors hover:border-soft hover:text-ink"
              >
                {idea}
              </button>
            ))}
          </div>

          {error && <p className="mt-4 text-sm text-accent">{error}</p>}
        </div>

        <PromptBar
          value={prompt}
          onChange={setPrompt}
          onSubmit={() => run(prompt)}
          busy={busy}
          onStop={stop}
          placeholder="Describe what to build…"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ArtifactToolbar
        code={code}
        filename="page.html"
        renderable
        view={view}
        onView={setView}
        onRun={() => setView("preview")}
      />

      <div className="min-h-0 flex-1">
        {busy ? (
          <CodePane code={draft || "Thinking…"} />
        ) : view === "preview" ? (
          <Preview html={code} />
        ) : (
          <CodePane code={code} onChange={setCode} editable />
        )}
      </div>

      {error && (
        <p className="border-t border-line px-4 py-2 text-sm text-accent">{error}</p>
      )}

      <PromptBar
        value={prompt}
        onChange={setPrompt}
        onSubmit={() => run(prompt)}
        busy={busy}
        onStop={stop}
        placeholder="Ask for a change…"
      />
    </div>
  );
}

function PromptBar({ value, onChange, onSubmit, busy, onStop, placeholder }) {
  return (
    <div className="border-t border-line p-3">
      <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-soft">
        <textarea
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          className="no-scrollbar max-h-[120px] flex-1 resize-none bg-transparent py-1 text-base outline-none placeholder:text-soft"
        />
        {busy ? (
          <Button variant="quiet" onClick={onStop} className="px-2 py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Stop
          </Button>
        ) : (
          <Button variant="solid" onClick={onSubmit} disabled={!value.trim()} className="px-2.5 py-1.5">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
            Build
          </Button>
        )}
      </div>
    </div>
  );
}
