import React from "react";
import { Activity, CreditCard, Link2, Palette, Sparkles } from "lucide-react";
import Customize from "./Customize.jsx";
import Design from "./Design.jsx";
import Connectors from "./Connectors.jsx";
import Billing from "./Billing.jsx";
import Setup from "../Setup.jsx";

// One destination for everything configurable, rather than a menu that fans out
// into separate panels.
const TABS = [
  { id: "assistant", name: "Assistant", icon: Sparkles },
  { id: "appearance", name: "Appearance", icon: Palette },
  { id: "connectors", name: "Connectors", icon: Link2 },
  { id: "billing", name: "Plan", icon: CreditCard },
  // The setup screen used to appear only when the app couldn't work, which made
  // it unreachable the moment it did — exactly when you want to check whether a
  // fix took. It lives here too now.
  { id: "status", name: "Status", icon: Activity }
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
        {/* `min-w-fit` beside `flex-1` is what stops a tab from being squeezed
            narrower than its own label: the tabs still share the width evenly
            when there's room, and stop shrinking at the point the text would
            start colliding. Past that the row scrolls rather than overlapping,
            so adding a sixth tab degrades instead of breaking — which is what
            adding the fifth one did. */}
        <div className="no-scrollbar flex overflow-x-auto rounded-xl bg-panel p-0.5">
          {TABS.map(({ id, name, icon: Icon }) => {
            const active = id === tab;
            return (
              <button
                key={id}
                onClick={() => onTab(id)}
                aria-current={active}
                className={`flex min-w-fit flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-[10px] px-2 py-1.5 text-sm font-medium transition-colors ${
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

        {tab === "billing" && <Billing />}

        {tab === "status" && <Setup />}

        {tab === "connectors" && (
          <Connectors
            settings={settings}
            onSettings={onSettings}
            connectors={connectors.items}
            signedIn={connectors.signedIn}
            can={connectors.can}
            onAdd={connectors.add}
            onUpdate={connectors.update}
            onRemove={connectors.remove}
          />
        )}
      </div>
    </div>
  );
}
