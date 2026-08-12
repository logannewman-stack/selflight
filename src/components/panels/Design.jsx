import React from "react";
import { Check, RotateCcw } from "lucide-react";
import {
  ACCENTS,
  BUBBLE_STYLES,
  CODE_SIZES,
  CORNERS,
  DENSITIES,
  FACES,
  LINE_SPACINGS,
  SEND_KEYS,
  TEXT_SIZES,
  THEMES,
  WIDTHS
} from "../../lib/themes.js";
import { DEFAULT_SETTINGS } from "../../lib/storage.js";
import { Button, Choice, Section, Toggle } from "../ui.jsx";

// Only the appearance keys reset — tone, instructions, and connectors are the
// user's content, not styling, and shouldn't be wiped by a look-and-feel reset.
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
  "uiFace",
  "readingFace",
  "textSize",
  "lineSpacing",
  "reduceMotion",
  "codeSize",
  "codeWrap",
  "lineNumbers",
  "sendKey",
  "autoArtifacts"
];

export default function Design({ settings, onSettings }) {
  const set = (key) => (value) => onSettings({ [key]: value });

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

  const reset = () => {
    onSettings(Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, DEFAULT_SETTINGS[k]])));
  };

  return (
    <div className="thin-scrollbar h-full overflow-y-auto">
      <Section
        title="Colour"
        hint="Different eyes and different rooms want different things. Pick whatever you can read longest without strain."
      >
        <Toggle
          label="Match system"
          hint="Follow your device between light and dark, using the pair you pick below."
          checked={settings.matchSystem}
          onChange={set("matchSystem")}
        />

        <div className="space-y-2">
          {THEMES.map((theme) => {
            const slot = slotFor(theme);
            return (
              <button
                key={theme.id}
                onClick={() => chooseTheme(theme)}
                className={`flex w-full items-start gap-3 rounded-xl border bg-surface px-3 py-2.5 text-left transition-colors ${
                  slot ? "border-accent" : "border-line hover:border-soft"
                }`}
              >
                <span className="mt-0.5 flex shrink-0 overflow-hidden rounded-md ring-1 ring-line">
                  {theme.swatch.map((colour) => (
                    <span key={colour} className="h-5 w-3" style={{ background: colour }} />
                  ))}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-base font-medium">{theme.name}</span>
                    {slot === "on" && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.6} />}
                    {(slot === "Light" || slot === "Dark") && (
                      <span className="rounded-full bg-accent px-1.5 py-0.5 text-2xs font-bold uppercase text-page">
                        {slot}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                    {theme.note}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

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
        </div>
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

      <Section title="Type">
        <FacePicker
          label="Interface"
          value={settings.uiFace}
          onChange={set("uiFace")}
          sample="Aa"
        />
        <FacePicker
          label="Replies"
          value={settings.readingFace}
          onChange={set("readingFace")}
          sample="Aa"
        />
        <Choice
          label="Text size"
          options={TEXT_SIZES}
          value={settings.textSize}
          onChange={set("textSize")}
        />
        <Choice
          label="Line spacing"
          options={LINE_SPACINGS}
          value={settings.lineSpacing}
          onChange={set("lineSpacing")}
        />
        <Toggle
          label="Reduce motion"
          hint="Removes fades and slides. Your system setting is honoured either way."
          checked={settings.reduceMotion}
          onChange={set("reduceMotion")}
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
        <Toggle
          label="Line numbers"
          checked={settings.lineNumbers}
          onChange={set("lineNumbers")}
        />
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
          Puts every setting on this panel back to its default. Your chats, instructions, and
          connectors are untouched.
        </p>
      </Section>
    </div>
  );
}

function FacePicker({ label, value, onChange, sample }) {
  return (
    <div>
      <p className="mb-2 text-base font-medium">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {FACES.map((face) => {
          const active = face.id === value;
          return (
            <button
              key={face.id}
              onClick={() => onChange(face.id)}
              className={`rounded-xl border bg-surface px-2.5 py-2 text-left transition-colors ${
                active ? "border-accent" : "border-line hover:border-soft"
              }`}
            >
              <span className="block text-lg leading-none" style={{ fontFamily: face.stack }}>
                {sample}
              </span>
              <span className="mt-1.5 block text-sm font-medium text-muted">{face.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
