import React from "react";
import { Area, Choice, Field, Section } from "../ui.jsx";

const TONES = [
  { id: "balanced", name: "Balanced" },
  { id: "warm", name: "Warm" },
  { id: "direct", name: "Direct" },
  { id: "playful", name: "Playful" }
];

const LENGTHS = [
  { id: "brief", name: "Brief" },
  { id: "adaptive", name: "Adaptive" },
  { id: "thorough", name: "Thorough" }
];

const DEPTHS = [
  { id: "quick", name: "Quick", hint: "Fastest and cheapest" },
  { id: "balanced", name: "Balanced", hint: "Good default" },
  { id: "deep", name: "Deep", hint: "Thinks longer on hard questions" }
];

export default function Customize({ settings, onSettings }) {
  const set = (key) => (value) => onSettings({ [key]: value });

  return (
    <div className="thin-scrollbar h-full overflow-y-auto">
      <Section title="How Selflight talks" hint="These fold into its instructions on every message.">
        <Choice label="Tone" options={TONES} value={settings.tone} onChange={set("tone")} />
        <Choice label="Answer length" options={LENGTHS} value={settings.length} onChange={set("length")} />
        <Choice
          label="Thinking depth"
          options={DEPTHS}
          value={settings.depth}
          onChange={set("depth")}
        />
      </Section>

      <Section title="What it knows about you">
        <Field
          label="Call me"
          placeholder="Logan"
          value={settings.callMe}
          onChange={(e) => onSettings({ callMe: e.target.value })}
        />
        <Area
          label="About you"
          rows={4}
          placeholder="What you work on, what you're building, anything it should assume rather than ask."
          value={settings.about}
          onChange={(e) => onSettings({ about: e.target.value })}
          hint="Sent with every message in this browser."
        />
      </Section>

      <Section
        title="Standing instructions"
        hint="Rules it follows unless a message overrides them."
      >
        <Area
          label="Always…"
          rows={5}
          placeholder={"Skip the recap at the end.\nGive me code before explanation.\nPush back when I'm wrong."}
          value={settings.instructions}
          onChange={(e) => onSettings({ instructions: e.target.value })}
        />
      </Section>
    </div>
  );
}
