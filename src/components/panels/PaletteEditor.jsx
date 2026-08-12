import React, { useEffect, useState } from "react";
import { Check, Clipboard, Download, Trash2 } from "lucide-react";
import {
  TOKEN_GROUPS,
  contrast,
  exportPalette,
  hexToTriplet,
  tripletToHex
} from "../../lib/palettes.js";
import { Button, Field, Section } from "../ui.jsx";

// WCAG AA for body text. Anything under this gets flagged rather than blocked —
// it's the author's palette, they just deserve to know.
const AA = 4.5;

export default function PaletteEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  onDelete,
  onRebase,
  existing,
  bases
}) {
  const [copied, setCopied] = useState(false);

  const setToken = (token) => (value) =>
    onChange({ ...draft, vars: { ...draft.vars, [token]: value } });

  const pairs = [
    ["Body text on page", draft.vars.ink, draft.vars.page],
    ["Secondary text on page", draft.vars.muted, draft.vars.page],
    ["Accent on page", draft.vars.accent, draft.vars.page],
    ["Bubble text on bubble", draft.vars.bubbleInk, draft.vars.bubble]
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportPalette(draft));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked outside a secure context; download still works.
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportPalette(draft)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.name.replace(/\W+/g, "-").toLowerCase() || "palette"}.selflight.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        <Section title="Package" hint="Edits preview live. Nothing is stored until you save.">
          <Field
            label="Name"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="My palette"
          />

          {/* Recolouring a light palette into a dark one by hand means editing
              ten tokens through an unusable middle state. Starting from a
              palette that already has the right footing avoids that entirely. */}
          <div>
            <p className="mb-2 text-base font-medium">Start from</p>
            <div className="flex flex-wrap gap-1.5">
              {bases.map((base) => (
                <button
                  key={base.id}
                  onClick={() => onRebase(base)}
                  title={`Load every colour from ${base.name}`}
                  className="flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1.5 text-sm font-medium text-muted ring-1 ring-line transition-colors hover:text-ink"
                >
                  <span className="flex overflow-hidden rounded-[3px] ring-1 ring-line">
                    {base.swatch.map((colour, i) => (
                      <span key={i} className="h-3 w-1.5" style={{ background: colour }} />
                    ))}
                  </span>
                  {base.name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-sm text-muted">Replaces every colour below. Your name is kept.</p>
          </div>
        </Section>

        <Section title="Readability" hint="Contrast ratios against WCAG AA for body text.">
          <div className="space-y-1.5">
            {pairs.map(([label, fg, bg]) => {
              const ratio = contrast(fg, bg);
              const pass = ratio >= AA;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className="flex h-6 w-8 shrink-0 items-center justify-center rounded-md border border-line text-2xs font-bold"
                    style={{ background: `rgb(${bg})`, color: `rgb(${fg})` }}
                  >
                    Aa
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted">{label}</span>
                  <span className="tabular text-sm font-medium">{ratio.toFixed(1)}:1</span>
                  <span
                    className={`w-10 shrink-0 text-right text-2xs font-bold uppercase ${
                      pass ? "text-accent" : "text-soft"
                    }`}
                  >
                    {pass ? "AA" : "low"}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        {TOKEN_GROUPS.map((group) => (
          <Section key={group.title} title={group.title}>
            <div className="space-y-2">
              {group.tokens.map(([token, label]) => (
                <TokenRow
                  key={token}
                  label={label}
                  value={draft.vars[token]}
                  onChange={setToken(token)}
                />
              ))}
            </div>
          </Section>
        ))}

        <Section title="Share" hint="A package is plain JSON — paste it anywhere or keep the file.">
          <div className="flex flex-wrap gap-2">
            <Button onClick={copy}>
              {copied ? (
                <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} />
              ) : (
                <Clipboard className="h-3.5 w-3.5" strokeWidth={2.2} />
              )}
              {copied ? "Copied" : "Copy JSON"}
            </Button>
            <Button onClick={download}>
              <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
              Download
            </Button>
          </div>
        </Section>

        {existing && (
          <Section title="Remove">
            <Button onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
              Delete this package
            </Button>
          </Section>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-line p-3">
        <Button variant="solid" onClick={onSave} className="flex-1">
          Save package
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TokenRow({ label, value, onChange }) {
  const hex = tripletToHex(value);

  return (
    <div className="flex items-center gap-2.5">
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(hexToTriplet(e.target.value))}
        aria-label={label}
        className="h-7 w-9 shrink-0 cursor-pointer rounded-md border border-line bg-surface p-[2px]"
      />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <HexField hex={hex} onCommit={onChange} label={label} />
    </div>
  );
}

// Buffered so a half-typed hex doesn't repaint the whole app on every keystroke.
function HexField({ hex, onCommit, label }) {
  const [text, setText] = useState(hex);

  useEffect(() => setText(hex), [hex]);

  const commit = () => {
    if (/^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$/i.test(text.trim())) onCommit(hexToTriplet(text));
    else setText(hex);
  };

  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      spellCheck={false}
      aria-label={`${label} hex`}
      className="w-[78px] shrink-0 rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs uppercase outline-none focus:border-soft"
    />
  );
}
