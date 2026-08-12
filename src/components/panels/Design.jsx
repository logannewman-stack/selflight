import React from "react";
import { Check } from "lucide-react";
import { TEXT_SIZES, THEMES } from "../../lib/themes.js";
import { Choice, Section, Toggle } from "../ui.jsx";

export default function Design({ settings, onSettings }) {
  return (
    <div className="thin-scrollbar h-full overflow-y-auto">
      <Section
        title="Colour"
        hint="Different eyes and different rooms want different things. Pick whatever you can read longest without strain."
      >
        <div className="space-y-2">
          {THEMES.map((theme) => {
            const active = theme.id === settings.theme;
            return (
              <button
                key={theme.id}
                onClick={() => onSettings({ theme: theme.id })}
                className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  active ? "border-accent bg-surface" : "border-line bg-surface hover:border-soft"
                }`}
              >
                <span className="mt-0.5 flex shrink-0 overflow-hidden rounded-md ring-1 ring-line">
                  {theme.swatch.map((colour) => (
                    <span key={colour} className="h-5 w-3" style={{ background: colour }} />
                  ))}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13.5px] font-medium">{theme.name}</span>
                    {active && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.6} />}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                    {theme.note}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Reading">
        <Choice
          label="Text size"
          options={TEXT_SIZES}
          value={settings.textSize}
          onChange={(v) => onSettings({ textSize: v })}
        />
        <Toggle
          label="Reduce motion"
          hint="Removes fades and slides. Your system setting is honoured either way."
          checked={settings.reduceMotion}
          onChange={(v) => onSettings({ reduceMotion: v })}
        />
      </Section>
    </div>
  );
}
