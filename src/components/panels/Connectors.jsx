import React, { useState } from "react";
import { Globe, Link2, Plus, Trash2 } from "lucide-react";
import { Button, Field, Section, Toggle } from "../ui.jsx";

export default function Connectors({
  settings,
  onSettings,
  connectors,
  signedIn,
  onAdd,
  onUpdate,
  onRemove
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", token: "" });
  const [problem, setProblem] = useState(null);

  const submit = () => {
    const name = form.name.trim();
    const url = form.url.trim();

    if (!name) return setProblem("Give the connector a name.");
    // Anthropic's servers make the connection, so the URL has to be reachable
    // from the public internet. Check that before the scheme, since a local
    // address is the more useful thing to explain.
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b/i.test(url)) {
      return setProblem("Localhost won't work — the server is reached from Anthropic's side, not yours.");
    }
    if (!/^https:\/\//i.test(url)) return setProblem("The URL must start with https://");

    onAdd({ name, url, token: form.token.trim() });
    setForm({ name: "", url: "", token: "" });
    setProblem(null);
    setAdding(false);
  };

  return (
    <div className="thin-scrollbar h-full overflow-y-auto">
      <Section title="Built in" hint="Server-side tools that need no setup.">
        <Toggle
          label="Web search"
          hint="Looks things up when the answer depends on current information."
          checked={settings.webSearch}
          onChange={(v) => onSettings({ webSearch: v })}
        />
        <Toggle
          label="Web fetch"
          hint="Reads a specific page when you paste a link or ask about one."
          checked={settings.webFetch}
          onChange={(v) => onSettings({ webFetch: v })}
        />
      </Section>

      <Section
        title="MCP connectors"
        hint="Connect a remote MCP server and Selflight can use its tools mid-conversation."
      >
        {connectors.length === 0 && !adding && (
          <div className="rounded-xl border border-dashed border-line px-3.5 py-5 text-center">
            <Link2 className="mx-auto mb-2 h-4 w-4 text-soft" strokeWidth={1.8} />
            <p className="text-sm leading-relaxed text-muted">
              Nothing connected yet. Add a server URL and its tools become available here.
            </p>
          </div>
        )}

        {connectors.map((connector) => (
          <div key={connector.id} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-start gap-2">
              <Globe className="mt-0.5 h-4 w-4 shrink-0 text-soft" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{connector.name}</p>
                <p className="truncate text-sm text-muted">{connector.url}</p>
              </div>
              <button
                onClick={() => onRemove(connector.id)}
                aria-label={`Remove ${connector.name}`}
                className="rounded-md p-1 text-soft transition-colors hover:text-accent"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>

            <div className="mt-2.5 border-t border-line pt-2.5">
              <Toggle
                label={connector.enabled ? "Active" : "Paused"}
                checked={connector.enabled}
                onChange={(v) => onUpdate(connector.id, { enabled: v })}
              />
            </div>

            {signedIn && (
              <TokenRow
                connector={connector}
                onSave={(token) => onUpdate(connector.id, { token })}
              />
            )}
          </div>
        ))}

        {adding ? (
          <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
            <Field
              label="Name"
              placeholder="linear"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Field
              label="Server URL"
              placeholder="https://mcp.example.com/sse"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
            <Field
              label="Auth token"
              type="password"
              placeholder="Optional"
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              hint={
                signedIn
                  ? "Stored server-side and never sent back to a browser — not even yours. Most hosted MCP servers want an OAuth token, not the service's normal API key."
                  : "Stored in this browser and sent with each request. Most hosted MCP servers want an OAuth token, not the service's normal API key."
              }
            />

            {problem && <p className="text-sm text-accent">{problem}</p>}

            <div className="flex gap-2">
              <Button variant="solid" onClick={submit}>
                Add connector
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setAdding(false);
                  setProblem(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            Add connector
          </Button>
        )}
      </Section>

      <Section title="Worth knowing">
        <p className="text-sm leading-relaxed text-muted">
          MCP servers are contacted by Anthropic's API rather than by your browser, so they have to
          be public HTTPS endpoints — a server on your own machine won't be reachable.
        </p>
        <p className="text-sm leading-relaxed text-muted">
          Connector support is a beta on the API. If your key doesn't have it yet, Selflight says so
          and answers without the connector instead of failing the message.
        </p>
        {signedIn && (
          <p className="text-sm leading-relaxed text-muted">
            Your tokens are kept in a table no signed-in user can read — only the server reaches them,
            and only to hand them to the API. That's why a stored token can be replaced but never shown.
          </p>
        )}
      </Section>
    </div>
  );
}

// A stored token is write-only by design, so this offers the two things that
// are actually possible: put a new one in, or take it away.
function TokenRow({ connector, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const commit = (token) => {
    onSave(token);
    setValue("");
    setEditing(false);
  };

  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      {editing ? (
        <div className="space-y-2">
          <Field
            label="Auth token"
            type="password"
            placeholder="Paste the new token"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="solid" onClick={() => commit(value.trim())}>
              Save token
            </Button>
            <Button variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm text-muted">
            {connector.hasToken ? "Auth token stored" : "No auth token"}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="rounded-md px-1.5 py-1 text-sm font-medium text-muted transition-colors hover:text-ink"
          >
            {connector.hasToken ? "Replace" : "Add"}
          </button>
          {connector.hasToken && (
            <button
              onClick={() => commit("")}
              className="rounded-md px-1.5 py-1 text-sm font-medium text-muted transition-colors hover:text-accent"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
