import React, { useState } from "react";
import { Check, Globe, Link2, Plus, Trash2 } from "lucide-react";
import { Button, Field, Section, Toggle } from "../ui.jsx";
import { connectService } from "../../lib/api.js";

export default function Connectors({
  settings,
  onSettings,
  connectors,
  signedIn,
  can = {},
  onAdd,
  onUpdate,
  onRemove
}) {
  const [adding, setAdding] = useState(false);
  // Two kinds of thing live behind one button now: an MCP server, and any API
  // with a base address and a key. The second is what makes "connect it to
  // anything" true, so it's the default — far more services have an API than
  // publish an MCP server.
  const [form, setForm] = useState({
    name: "",
    url: "",
    token: "",
    kind: "http",
    baseUrl: "",
    authStyle: "bearer",
    authName: "",
    description: "",
    writes: false
  });
  const [problem, setProblem] = useState(null);
  // Which Connect button was pressed, so it can say so while the redirect is
  // still being arranged.
  const [starting, setStarting] = useState(null);
  const [startProblem, setStartProblem] = useState(null);

  const services = can.services || [];
  // A connector created by signing in belongs to its service's row above, not
  // to the hand-added list below — otherwise every connection appears twice.
  const connectedTo = new Map(connectors.filter((c) => c.provider).map((c) => [c.provider, c]));
  const manual = connectors.filter((c) => !c.provider);

  const connect = async (id) => {
    setStarting(id);
    setStartProblem(null);
    const failed = await connectService(id);
    if (failed) {
      setStartProblem({ id, message: failed });
      setStarting(null);
    }
    // On success the browser has already left for the provider.
  };

  const reset = () =>
    setForm({
      name: "",
      url: "",
      token: "",
      kind: "http",
      baseUrl: "",
      authStyle: "bearer",
      authName: "",
      description: "",
      writes: false
    });

  // Checked here as well as on the server. The server's copy is the one that
  // counts — this one exists so a mistake is answered instantly rather than
  // after a round trip.
  const submitApi = (name) => {
    const baseUrl = form.baseUrl.trim();
    if (!/^https:\/\//i.test(baseUrl)) {
      return setProblem("The address has to start with https://");
    }
    if (/localhost|127\.0\.0\.1|169\.254\.|\b10\.|192\.168\.|\.local\b|\.internal\b/i.test(baseUrl)) {
      return setProblem("That's a private address, not a public API.");
    }
    if ((form.authStyle === "header" || form.authStyle === "query") && !form.authName.trim()) {
      return setProblem(
        form.authStyle === "header" ? "Which header carries the key?" : "Which parameter carries the key?"
      );
    }

    onAdd({
      name,
      kind: "http",
      url: baseUrl,
      baseUrl,
      authStyle: form.authStyle,
      authName: form.authName.trim() || null,
      description: form.description.trim(),
      methods: form.writes ? ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] : ["GET", "HEAD"],
      token: form.token.trim()
    });
    reset();
  };

  const submit = () => {
    const name = form.name.trim();
    if (form.kind === "http") return submitApi(name);

    const url = form.url.trim();

    if (!name) return setProblem("Give the connector a name.");
    // Anthropic's servers make the connection, so the URL has to be reachable
    // from the public internet. Check that before the scheme, since a local
    // address is the more useful thing to explain.
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b/i.test(url)) {
      return setProblem("Localhost won't work — the server is reached from Anthropic's side, not yours.");
    }
    if (!/^https:\/\//i.test(url)) return setProblem("The URL must start with https://");

    onAdd({ name, url, token: form.token.trim(), kind: "mcp" });
    reset();
    setProblem(null);
    setAdding(false);
  };

  return (
    <div className="thin-scrollbar h-full overflow-y-auto">
      <Section title="Built in" hint="Server-side tools that need no setup.">
        <Toggle
          label="Web search"
          hint={
            can.searchAlwaysOn
              ? "Sonar answers from a live search and cites what it read. Turning this off asks it to answer from training data alone — faster and cheaper, but it won't know about anything recent."
              : "Looks things up when the answer depends on current information."
          }
          checked={settings.webSearch}
          onChange={(v) => onSettings({ webSearch: v })}
        />
        {!can.searchAlwaysOn && (
          <Toggle
            label="Web fetch"
            hint="Reads a specific page when you paste a link or ask about one."
            checked={settings.webFetch}
            onChange={(v) => onSettings({ webFetch: v })}
          />
        )}
      </Section>

      <Section
        title="Your accounts"
        hint="Sign in once and Polstar can work with them in a conversation."
      >
        {!signedIn && (
          <div className="rounded-xl border border-dashed border-line px-3.5 py-5 text-center">
            <Link2 className="mx-auto mb-2 h-4 w-4 text-soft" strokeWidth={1.8} />
            <p className="text-sm leading-relaxed text-muted">
              Sign in to Polstar first. A connected account belongs to a person, so there has to
              be one to attach it to.
            </p>
          </div>
        )}

        {signedIn &&
          services.map((service) => {
            const linked = connectedTo.get(service.id);
            return (
              <div key={service.id} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start gap-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-base font-medium">
                      {service.name}
                      {linked && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.6} />}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted">
                      {linked
                        ? `Connected${linked.account ? ` as ${linked.account}` : ""}.`
                        : service.blurb}
                    </p>
                  </div>

                  {linked ? (
                    <button
                      onClick={() => onRemove(linked.id)}
                      className="shrink-0 rounded-md px-1.5 py-1 text-sm font-medium text-muted transition-colors hover:text-accent"
                    >
                      Disconnect
                    </button>
                  ) : (
                    service.ready && (
                      <Button onClick={() => connect(service.id)} disabled={starting === service.id}>
                        {starting === service.id ? "Opening…" : "Connect"}
                      </Button>
                    )
                  )}
                </div>

                {/* A service nobody registered an app for can't be connected by
                    anyone, so it says which variable is missing rather than
                    offering a button that fails after the redirect. */}
                {!service.ready && !linked && (
                  <p className="mt-2 border-t border-line pt-2 text-sm leading-relaxed text-muted">
                    Not set up on this deployment. Register an app at{" "}
                    <a
                      href={service.register}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-ink underline decoration-line underline-offset-2"
                    >
                      {service.name}
                    </a>
                    , then add{" "}
                    {service.missing.map((name, i) => (
                      <React.Fragment key={name}>
                        {i > 0 && " and "}
                        <code className="font-mono text-2xs">{name}</code>
                      </React.Fragment>
                    ))}{" "}
                    in Vercel and redeploy.
                  </p>
                )}

                {linked && (
                  <div className="mt-2.5 border-t border-line pt-2.5">
                    <Toggle
                      label={linked.enabled ? "Active" : "Paused"}
                      checked={linked.enabled}
                      onChange={(v) => onUpdate(linked.id, { enabled: v })}
                    />
                  </div>
                )}

                {startProblem?.id === service.id && (
                  <p className="mt-2 text-sm text-accent">{startProblem.message}</p>
                )}
              </div>
            );
          })}

        {signedIn && can.connectors === false && (
          <p className="text-sm leading-relaxed text-muted">
            Connecting works now and the token is stored safely, but{" "}
            {can.provider || "the current model"} can't call these tools yet — that needs a model
            with tool use. Set <code className="font-mono text-2xs">ANTHROPIC_API_KEY</code> and a
            connected account becomes usable in the conversation immediately.
          </p>
        )}
      </Section>

      <Section
        title="MCP connectors"
        hint="Any other remote MCP server, by URL."
      >
        {can.connectors === false && (
          <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
            <p className="text-base font-medium">Not available on {can.provider || "this model"}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              MCP is an Anthropic protocol and Perplexity's API has no equivalent, so anything you
              add here won't be reached. Set <code className="font-mono text-2xs">ANTHROPIC_API_KEY</code>{" "}
              instead of <code className="font-mono text-2xs">PERPLEXITY_API_KEY</code> to switch
              Polstar over to Claude, which does support them.
            </p>
          </div>
        )}

        {manual.length === 0 && !adding && can.connectors !== false && (
          <div className="rounded-xl border border-dashed border-line px-3.5 py-5 text-center">
            <Link2 className="mx-auto mb-2 h-4 w-4 text-soft" strokeWidth={1.8} />
            <p className="text-sm leading-relaxed text-muted">
              Nothing connected yet. Add a server URL and its tools become available here.
            </p>
          </div>
        )}

        {manual.map((connector) => (
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
            {/* Which kind, said in terms of what you have rather than what
                the protocol is called. Nobody arrives knowing whether the
                thing they want publishes an MCP server. */}
            <div className="flex gap-1.5">
              {[
                ["http", "An API and a key"],
                ["mcp", "An MCP server"]
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setForm({ ...form, kind: id })}
                  aria-pressed={form.kind === id}
                  className={`flex-1 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    form.kind === id
                      ? "border-accent bg-accent/10 text-ink"
                      : "border-line text-muted hover:border-soft"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <Field
              label="Name"
              placeholder={form.kind === "http" ? "Stripe" : "linear"}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              hint={form.kind === "http" ? "What the model will call it." : undefined}
            />

            {form.kind === "mcp" ? (
              <Field
                label="Server URL"
                placeholder="https://mcp.example.com/sse"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            ) : (
              <>
                <Field
                  label="Base address"
                  placeholder="https://api.stripe.com/v1"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  hint="The model picks a path under this. It can never reach another host."
                />
                <Field
                  label="What it's for"
                  placeholder="Payments, customers and invoices."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  hint="One line. The model reads this to decide when to use it."
                />

                <div>
                  <p className="mb-1 text-sm font-medium">How the key is sent</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      ["bearer", "Bearer token"],
                      ["header", "A header"],
                      ["query", "A query parameter"],
                      ["none", "No key needed"]
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setForm({ ...form, authStyle: id })}
                        aria-pressed={form.authStyle === id}
                        className={`rounded-full border px-2.5 py-1 text-sm transition-colors ${
                          form.authStyle === id
                            ? "border-accent bg-accent/10 text-ink"
                            : "border-line text-muted hover:border-soft"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {(form.authStyle === "header" || form.authStyle === "query") && (
                  <Field
                    label={form.authStyle === "header" ? "Header name" : "Parameter name"}
                    placeholder={form.authStyle === "header" ? "X-Api-Key" : "api_key"}
                    value={form.authName}
                    onChange={(e) => setForm({ ...form, authName: e.target.value })}
                  />
                )}

                {/* Off by default and deliberately blunt about it. A model that
                    can DELETE by default is one confused turn from a bad
                    afternoon, and the person turning this on should know that
                    is what they are turning on. */}
                <label className="flex items-start gap-2.5 rounded-lg border border-line bg-page p-2.5">
                  <input
                    type="checkbox"
                    checked={form.writes}
                    onChange={(e) => setForm({ ...form, writes: e.target.checked })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
                  />
                  <span className="min-w-0 text-sm leading-relaxed">
                    <span className="block font-medium">Let it change things</span>
                    <span className="block text-muted">
                      Without this it can only read. With it, the model can create, update and
                      delete through this API on your behalf.
                    </span>
                  </span>
                </label>
              </>
            )}
            <Field
              label={form.kind === "http" ? "Key" : "Auth token"}
              type="password"
              placeholder={form.authStyle === "none" ? "Not needed" : "Optional"}
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
                {form.kind === "http" ? "Connect the API" : "Add connector"}
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
          can.connectors !== false && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              Add connector
            </Button>
          )
        )}
      </Section>

      <Section title="Worth knowing">
        {can.searchAlwaysOn ? (
          <p className="text-sm leading-relaxed text-muted">
            Sonar searches as part of answering rather than through a separate tool, so replies come
            with sources attached. Thinking depth in Customize also sets how widely it reads — and
            that's the main thing your usage costs.
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted">
              MCP servers are contacted by Anthropic's API rather than by your browser, so they have
              to be public HTTPS endpoints — a server on your own machine won't be reachable.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              Connector support is a beta on the API. If your key doesn't have it yet, Polstar says
              so and answers without the connector instead of failing the message.
            </p>
          </>
        )}
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
