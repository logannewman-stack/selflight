import React from "react";
import { X } from "lucide-react";
import Artifacts from "./panels/Artifacts.jsx";
import Connectors from "./panels/Connectors.jsx";
import Customize from "./panels/Customize.jsx";
import Design from "./panels/Design.jsx";

const TITLES = {
  artifacts: "Artifacts",
  connectors: "Connectors",
  customize: "Customize",
  design: "Design"
};

export default function RightPanel({ section, onClose, artifacts, settings, onSettings, connectors }) {
  return (
    <aside className="flex h-full w-full flex-col border-l border-line bg-page md:w-[400px] lg:w-[460px]">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="flex-1 text-[14px] font-medium">{TITLES[section]}</span>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-panel hover:text-ink"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      <div className="min-h-0 flex-1">
        {section === "artifacts" && <Artifacts artifacts={artifacts} />}
        {section === "connectors" && (
          <Connectors
            settings={settings}
            onSettings={onSettings}
            connectors={connectors.items}
            onAdd={connectors.add}
            onUpdate={connectors.update}
            onRemove={connectors.remove}
          />
        )}
        {section === "customize" && <Customize settings={settings} onSettings={onSettings} />}
        {section === "design" && <Design settings={settings} onSettings={onSettings} />}
      </div>
    </aside>
  );
}
