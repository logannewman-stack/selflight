import React from "react";
import { Link2, Palette, Sparkles } from "lucide-react";
import Customize from "./Customize.jsx";
import Design from "./Design.jsx";
import Connectors from "./Connectors.jsx";

// One destination for everything configurable, rather than a menu that fans out
// into separate panels.
const TABS = [
  { id: "assistant", name: "Assistant", icon: Sparkles },
  { id: "appearance", name: "Appearance", icon: Palette },
  { id: "connectors", name: "Connectors", icon: Link2 }
];

export default function Settings({
  tab,
  onTab,
  settings,
  onSettings,
  connectors,
  themes,
  palette
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 py-2.5">
        <div className="flex rounded-xl bg-panel p-0.5">
          {TABS.map(({ id, name, icon: Icon }) => {
            const active = id === tab;
            return (
              <button
                key={id}
                onClick={() => onTab(id)}
                aria-current={active}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2.1} />
                {name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 border-t border-line">
        {tab === "assistant" && <Customize settings={settings} onSettings={onSettings} />}

        {tab === "appearance" && (
          <Design
            settings={settings}
            onSettings={onSettings}
            themes={themes}
            onEditPalette={palette.edit}
            onNewPalette={palette.create}
            onImportPalette={palette.import}
          />
        )}

        {tab === "connectors" && (
          <Connectors
            settings={settings}
            onSettings={onSettings}
            connectors={connectors.items}
            onAdd={connectors.add}
            onUpdate={connectors.update}
            onRemove={connectors.remove}
          />
        )}
      </div>
    </div>
  );
}
