import React, { useEffect, useState } from "react";
import { Shapes } from "lucide-react";
import { ArtifactToolbar, CodePane, Preview } from "../ArtifactView.jsx";
import { extensionFor, toDocument } from "../../lib/artifacts.js";
import { Empty } from "../ui.jsx";

export default function Artifacts({ artifacts }) {
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("preview");

  const selected = artifacts.find((a) => a.id === selectedId) || artifacts[artifacts.length - 1];

  // Follow along as new artifacts appear, without fighting a manual choice.
  useEffect(() => {
    if (!artifacts.length) return setSelectedId(null);
    if (!artifacts.some((a) => a.id === selectedId)) {
      setSelectedId(artifacts[artifacts.length - 1].id);
    }
  }, [artifacts, selectedId]);

  useEffect(() => {
    if (selected) setView(selected.renderable ? "preview" : "code");
  }, [selected?.id, selected?.renderable]);

  if (!artifacts.length) {
    return (
      <Empty icon={Shapes} title="Nothing built yet">
        Code and pages Selflight writes during a chat collect here, where you can preview, edit,
        and download them.
      </Empty>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {artifacts.length > 1 && (
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              onClick={() => setSelectedId(artifact.id)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                artifact.id === selected.id
                  ? "bg-ink text-page"
                  : "bg-surface text-muted ring-1 ring-line hover:text-ink"
              }`}
            >
              {artifact.title}
            </button>
          ))}
        </div>
      )}

      <ArtifactToolbar
        code={selected.code}
        filename={`${selected.title.replace(/\W+/g, "-").toLowerCase()}.${extensionFor(selected.language)}`}
        renderable={selected.renderable}
        view={view}
        onView={setView}
      />

      <div className="min-h-0 flex-1">
        {view === "preview" && selected.renderable ? (
          <Preview html={toDocument(selected)} />
        ) : (
          <CodePane code={selected.code} />
        )}
      </div>
    </div>
  );
}
