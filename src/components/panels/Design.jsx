import React, { useEffect, useState } from "react";
import { Check, ClipboardPaste, Pencil, Plus, RotateCcw } from "lucide-react";
import {
  ACCENTS,
  BUBBLE_STYLES,
  CODE_SIZES,
  CORNERS,
  DENSITIES,
  HEADING_SCALES,
  LINE_SPACINGS,
  PARA_SPACINGS,
  SEND_KEYS,
  TEXT_SIZES,
  TRACKINGS,
  WEIGHTS,
  WIDTHS
} from "../../lib/themes.js";
import { MONO_FONTS, TEXT_FONTS, fontById, loadFonts } from "../../lib/fonts.js";
import { DEFAULT_SETTINGS } from "../../lib/storage.js";
import { Area, Button, Choice, Section, Toggle } from "../ui.jsx";

// Only appearance keys reset — tone, instructions, and connectors are content,
// not styling, and shouldn't be wiped by a look-and-feel reset.
const APPEARANCE_KEYS = [
  "theme",
  "matchSystem",
  "lightTheme",
  "darkTheme",
  "accent",
  "density",
  "width",
  "corners",
  "bubbles",
  "uiFont",
  "replyFont",
  "codeFont",
  "textSize",
  "lineSpacing",
  "bodyWeight",
  "tracking",
  "headingScale",
  "paraSpacing",
  "reduceMotion",
  "codeSize",
  "codeWrap",
  "lineNumbers",
  "sendKey",
  "autoArtifacts"
];

export default function Design({
  settings,
  onSettings,
  themes,
  onEditPalette,
  onNewPalette,
  onImportPalette
}) {
  const set = (key) => (value) => onSettings({ [key]: value });
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState(null);

  const chooseTheme = (theme) => {
    // With "match system" on, a palette claims the light or dark slot it
    // belongs to rather than overriding the current one.
    if (settings.matchSystem) {
      onSettings(theme.dark ? { darkTheme: theme.id } : { lightTheme: theme.id });
    } else {
      onSettings({ theme: theme.id });
    }
  };

  const slotFor = (theme) => {
    if (!settings.matchSystem) return theme.id === settings.theme ? "on" : null;
    if (theme.id === settings.lightTheme) return "Light";
    if (theme.id === settings.darkTheme) return "Dark";
    return null;
  };

  const runImport = () => {
    const problem = onImportPalette(importText);
    if (problem) return setImportError(problem);
    setImportText("");
    setImportError(null);
    setImporting(false);
  };

  const reset = () =>
    onSettings(Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, DEFAULT_SETTINGS[k]])));

  return (
    <div className="thin-scrollbar h-full overflow-y-auto">
      <Section
        title="Colour packages"
        hint="Pick one, or build your own from any of these and share it as a file."
      >
        <Toggle
          label="Match system"
          hint="Follow your device between light and dark, using the pair you pick below."
          checked={settings.matchSystem}
          onChange={set("matchSystem")}
        />

        <div className="space-y-2">
          {themes.map((theme) => {
            const slot = slotFor(theme);
            return (
              <div
                key={theme.id}
                className={`group flex items-start gap-2 rounded-xl border bg-surface px-3 py-2.5 transition-colors ${
                  slot ? "border-accent" : "border-line hover:border-soft"
                }`}
              >
                <button
                  onClick={() => chooseTheme(theme)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <span className="mt-0.5 flex shrink-0 overflow-hidden rounded-md ring-1 ring-line">
                    {theme.swatch.map((colour, i) => (
                      <span key={`${colour}-${i}`} className="h-5 w-3" style={{ background: colour }} />
                    ))}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-base font-medium">{theme.name}</span>
                      {slot === "on" && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.6} />}
                      {(slot === "Light" || slot === "Dark") && (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-2xs font-bold uppercase text-page">
                          {slot}
                        </span>
                      )}
                      {theme.custom && (
                        <span className="rounded-full bg-line px-1.5 py-0.5 text-2xs font-bold uppercase text-muted">
                          Yours
                        </span>
                      )}
                    </span>
                    {theme.note && (
                      <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                        {theme.note}
                      </span>
                    )}
                  </span>
                </button>

                <button
                  onClick={() => onEditPalette(theme)}
                  aria-label={theme.custom ? `Edit ${theme.name}` : `Duplicate ${theme.name}`}
                  title={theme.custom ? "Edit" : "Duplicate and edit"}
                  className="shrink-0 rounded-md p-1.5 text-soft opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onNewPalette}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            New package
          </Button>
          <Button onClick={() => setImporting((v) => !v)}>
            <ClipboardPaste className="h-3.5 w-3.5" strokeWidth={2.2} />
            Import
          </Button>
        </div>

        {importing && (
          <div className="space-y-2.5 rounded-xl border border-line bg-surface p-3">
            <Area
              label="Paste a package"
              rows={5}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{ "name": "Sunset", "vars": { "page": "#1b1016", "ink": "#f6e9de", … } }'
              hint="Hex or “r g b” values both work, as does a bare map of colours."
            />
            {importError && <p className="text-sm text-accent">{importError}</p>}
            <Button variant="solid" onClick={runImport} disabled={!importText.trim()}>
              Import package
            </Button>
          </div>
        )}

        <div>
          <p className="mb-2 text-base font-medium">Accent</p>
          <div className="flex flex-wrap gap-1.5">
            {ACCENTS.map((accent) => {
              const active = accent.id === settings.accent;
              return (
                <button
                  key={accent.id}
                  onClick={() => onSettings({ accent: accent.id })}
                  title={accent.name}
                  aria-label={`Accent: ${accent.name}`}
                  className={`flex h-7 w-7 items-center justify-center rounded-full ring-1 transition-transform ${
                    active ? "ring-2 ring-ink" : "ring-line hover:scale-110"
                  }`}
                  style={accent.rgb ? { background: `rgb(${accent.rgb})` } : undefined}
                >
                  {/* The palette's own accent has no fixed swatch to show. */}
                  {!accent.rgb && <span className="text-2xs font-bold text-muted">A</span>}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-sm text-muted">
            Overrides a built-in palette's accent. Your own packages keep theirs.
          </p>
        </div>
      </Section>

      <Section title="Typefaces" hint="Twenty-odd faces, fetched only when you choose one.">
        <FontPicker
          label="Interface"
          value={settings.uiFont}
          options={TEXT_FONTS}
          fallback="geist"
          onChange={set("uiFont")}
        />
        <FontPicker
          label="Replies"
          value={settings.replyFont}
          options={TEXT_FONTS}
          fallback="geist"
          onChange={set("replyFont")}
        />
        <FontPicker
          label="Code"
          value={settings.codeFont}
          options={MONO_FONTS}
          fallback="geist-mono"
          onChange={set("codeFont")}
        />
      </Section>

      <Section title="Typography">
        <Choice
          label="Text size"
          options={TEXT_SIZES}
          value={settings.textSize}
          onChange={set("textSize")}
        />
        <Choice
          label="Weight"
          options={WEIGHTS}
          value={settings.bodyWeight}
          onChange={set("bodyWeight")}
        />
        <Choice
          label="Line spacing"
          options={LINE_SPACINGS}
          value={settings.lineSpacing}
          onChange={set("lineSpacing")}
        />
        <Choice
          label="Letter spacing"
          options={TRACKINGS}
          value={settings.tracking}
          onChange={set("tracking")}
        />
        <Choice
          label="Paragraph spacing"
          options={PARA_SPACINGS}
          value={settings.paraSpacing}
          onChange={set("paraSpacing")}
        />
        <Choice
          label="Heading size"
          options={HEADING_SCALES}
          value={settings.headingScale}
          onChange={set("headingScale")}
        />
        <Toggle
          label="Reduce motion"
          hint="Removes fades and slides. Your system setting is honoured either way."
          checked={settings.reduceMotion}
          onChange={set("reduceMotion")}
        />
      </Section>

      <Section title="Layout">
        <Choice
          label="Density"
          options={DENSITIES}
          value={settings.density}
          onChange={set("density")}
        />
        <Choice
          label="Conversation width"
          options={WIDTHS}
          value={settings.width}
          onChange={set("width")}
        />
        <Choice label="Corners" options={CORNERS} value={settings.corners} onChange={set("corners")} />
        <Choice
          label="Your messages"
          options={BUBBLE_STYLES}
          value={settings.bubbles}
          onChange={set("bubbles")}
        />
      </Section>

      <Section title="Code">
        <Choice
          label="Code size"
          options={CODE_SIZES}
          value={settings.codeSize}
          onChange={set("codeSize")}
        />
        <Toggle
          label="Wrap long lines"
          hint="Wrap instead of scrolling sideways. Turns line numbers off, since a gutter can't track a reflowed line."
          checked={settings.codeWrap}
          onChange={set("codeWrap")}
        />
        <Toggle label="Line numbers" checked={settings.lineNumbers} onChange={set("lineNumbers")} />
      </Section>

      <Section title="Behaviour">
        <Choice
          label="Send with"
          options={SEND_KEYS}
          value={settings.sendKey}
          onChange={set("sendKey")}
        />
        <Toggle
          label="Open artifacts automatically"
          hint="Show the canvas as soon as Selflight writes something."
          checked={settings.autoArtifacts}
          onChange={set("autoArtifacts")}
        />
      </Section>

      <Section title="Reset">
        <Button onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
          Reset appearance
        </Button>
        <p className="text-sm leading-relaxed text-muted">
          Puts every setting on this panel back to its default. Your chats, instructions, connectors,
          and saved packages are untouched.
        </p>
      </Section>
    </div>
  );
}

function FontPicker({ label, value, options, fallback, onChange }) {
  const [open, setOpen] = useState(false);
  const current = fontById(value, fallback);

  // Specimens are only honest once the faces are here, so the whole catalogue
  // loads when someone actually opens the list — not on first paint.
  useEffect(() => {
    if (open) loadFonts(options.map((o) => o.id));
  }, [open, options]);

  const groups = [...new Set(options.map((o) => o.group))];

  return (
    <div>
      <p className="mb-2 text-base font-medium">{label}</p>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left transition-colors ${
          open ? "border-accent" : "border-line hover:border-soft"
        }`}
      >
        <span className="text-lg leading-none" style={{ fontFamily: current.stack }}>
          Aa
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{current.name}</span>
          {current.note && <span className="block truncate text-sm text-muted">{current.note}</span>}
        </span>
        <span className="shrink-0 text-sm text-soft">{open ? "Close" : "Change"}</span>
      </button>

      {open && (
        <div className="thin-scrollbar mt-2 max-h-[19rem] overflow-y-auto rounded-xl border border-line bg-surface">
          {groups.map((group) => (
            <div key={group}>
              <p className="sticky top-0 bg-panel px-3 py-1.5 text-2xs font-bold uppercase text-soft">
                {group}
              </p>
              {options
                .filter((o) => o.group === group)
                .map((option) => {
                  const active = option.id === value;
                  return (
                    <button
                      key={option.id}
                      onClick={() => {
                        onChange(option.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-baseline gap-3 px-3 py-2 text-left transition-colors hover:bg-panel ${
                        active ? "bg-panel" : ""
                      }`}
                    >
                      <span
                        className="w-[5.5rem] shrink-0 truncate text-base"
                        style={{ fontFamily: option.stack }}
                      >
                        {option.name}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-sm text-muted"
                        style={{ fontFamily: option.stack }}
                      >
                        {option.note || "Handgloves 0123"}
                      </span>
                      {active && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.6} />
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
