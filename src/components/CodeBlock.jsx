import React, { useMemo, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { highlight, labelFor } from "../lib/highlight.js";

// Long blocks collapse so one big file doesn't bury the rest of the reply.
const COLLAPSE_AFTER = 22;

export default function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const html = useMemo(() => highlight(code, language), [code, language]);
  const lines = useMemo(() => code.split("\n").length, [code]);

  const collapsible = lines > COLLAPSE_AFTER && !expanded;
  const label = labelFor(language);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard is blocked outside a secure context; the code is selectable.
    }
  };

  return (
    <div className="group/code mb-3 overflow-hidden rounded-xl border border-line bg-codebg last:mb-0">
      <div className="flex items-center gap-2 border-b border-line/70 px-3 py-1.5">
        <span className="text-2xs font-semibold uppercase text-soft">{label || "Code"}</span>
        <span className="flex-1" />
        <span className="tabular text-2xs text-soft">
          {lines} line{lines === 1 ? "" : "s"}
        </span>
        <button
          onClick={copy}
          aria-label="Copy code"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-2xs font-semibold uppercase text-soft transition-colors hover:bg-line/60 hover:text-ink"
        >
          {copied ? (
            <Check className="h-3 w-3 text-accent" strokeWidth={2.6} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={2.2} />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="relative">
        <pre
          className={`thin-scrollbar overflow-x-auto px-3.5 py-3 font-mono text-[0.82em] leading-[1.65] ${
            collapsible ? "max-h-[22rem] overflow-y-hidden" : ""
          }`}
        >
          {html ? (
            <code dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <code>{code}</code>
          )}
        </pre>

        {collapsible && (
          <button
            onClick={() => setExpanded(true)}
            className="absolute inset-x-0 bottom-0 flex items-end justify-center bg-gradient-to-t from-codebg via-codebg/90 to-transparent pb-2 pt-10 text-xs font-medium text-muted transition-colors hover:text-ink"
          >
            <span className="flex items-center gap-1">
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2.2} />
              Show all {lines} lines
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
