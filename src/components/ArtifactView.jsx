import React, { useState } from "react";
import { Check, Copy, Download, ExternalLink, Play } from "lucide-react";

// Generated pages run without `allow-same-origin`, so they get scripts but no
// access to this app's storage, cookies, or DOM.
const SANDBOX = "allow-scripts allow-forms allow-popups allow-modals";

export function Preview({ html }) {
  return (
    <iframe
      title="Preview"
      sandbox={SANDBOX}
      srcDoc={html}
      className="h-full w-full border-0 bg-white"
    />
  );
}

export function CodePane({ code, onChange, editable }) {
  if (editable) {
    return (
      <textarea
        value={code}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="thin-scrollbar h-full w-full resize-none bg-codebg p-4 font-mono text-sm leading-relaxed outline-none"
      />
    );
  }

  return (
    <pre className="thin-scrollbar h-full overflow-auto bg-codebg p-4 font-mono text-sm leading-relaxed">
      <code>{code}</code>
    </pre>
  );
}

export function ArtifactToolbar({ code, filename, renderable, view, onView, onRun }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard is blocked outside a secure context; the code is selectable.
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openTab = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    // Give the new tab time to load before dropping the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  return (
    <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
      {renderable && (
        <div className="mr-1 flex rounded-lg bg-panel p-0.5">
          {["preview", "code"].map((mode) => (
            <button
              key={mode}
              onClick={() => onView(mode)}
              className={`rounded-[6px] px-2.5 py-1 text-sm font-medium capitalize transition-colors ${
                view === mode ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {onRun && view === "code" && (
        <IconButton onClick={onRun} label="Run the edited code">
          <Play className="h-3.5 w-3.5" strokeWidth={2} />
        </IconButton>
      )}
      <IconButton onClick={copy} label="Copy code">
        {copied ? (
          <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </IconButton>
      <IconButton onClick={download} label="Download file">
        <Download className="h-3.5 w-3.5" strokeWidth={2} />
      </IconButton>
      {renderable && (
        <IconButton onClick={openTab} label="Open in a new tab">
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
        </IconButton>
      )}
    </div>
  );
}

function IconButton({ children, onClick, label }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-muted transition-colors hover:bg-panel hover:text-ink"
    >
      {children}
    </button>
  );
}
