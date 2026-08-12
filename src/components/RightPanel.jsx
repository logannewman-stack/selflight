import React from "react";
import { ChevronLeft, X } from "lucide-react";
import Artifacts from "./panels/Artifacts.jsx";
import Settings from "./panels/Settings.jsx";
import PaletteEditor from "./panels/PaletteEditor.jsx";

const TITLES = {
  artifacts: "Artifacts",
  settings: "Settings",
  palette: "Colour package"
};

export default function RightPanel({
  section,
  settingsTab,
  onSettingsTab,
  onClose,
  artifacts,
  settings,
  onSettings,
  connectors,
  themes,
  palette
}) {
  return (
    <aside className="slide-in flex h-full w-full flex-col border-l border-line bg-page md:w-[400px] lg:w-[460px]">
      <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line px-3">
        {/* The editor is a detour off Appearance, so it gets a way back rather
            than only a way out. */}
        {section === "palette" && (
          <button
            onClick={palette.cancel}
            aria-label="Back to appearance"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-panel hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.2} />
          </button>
        )}

        <span className="flex-1 truncate px-1 text-base font-semibold tracking-[-0.005em]">
          {TITLES[section]}
        </span>

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

        {section === "settings" && (
          <Settings
            tab={settingsTab}
            onTab={onSettingsTab}
            settings={settings}
            onSettings={onSettings}
            connectors={connectors}
            themes={themes}
            palette={palette}
          />
        )}

        {section === "palette" && palette.draft && (
          <PaletteEditor
            draft={palette.draft}
            existing={palette.existing}
            onChange={palette.change}
            onSave={palette.save}
            onCancel={palette.cancel}
            onDelete={palette.remove}
            onRebase={palette.rebase}
            bases={themes.filter((t) => !t.custom)}
          />
        )}
      </div>
    </aside>
  );
}
