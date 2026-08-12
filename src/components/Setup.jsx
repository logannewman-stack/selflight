import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Mark } from "./Logo.jsx";

// Shown instead of the app when Selflight can't work yet, and reachable from
// Settings once it can. Everything here is a thing you fix in a browser tab —
// no terminal, because needing one to find out what's wrong is a bad answer for
// most of the people who'd want to run this.

export default function Setup({ onDone }) {
  const [report, setReport] = useState(null);
  const [checking, setChecking] = useState(true);
  const [testing, setTesting] = useState(false);

  const check = useCallback(async (live) => {
    live ? setTesting(true) : setChecking(true);
    try {
      const res = await fetch(`/api/doctor${live ? "?live=1" : ""}`);
      setReport(await res.json());
    } catch {
      setReport({ unreachable: true });
    }
    setChecking(false);
    setTesting(false);
  }, []);

  useEffect(() => {
    check(false);
  }, [check]);

  if (checking && !report) {
    return (
      <Frame>
        <Loader2 className="h-5 w-5 animate-spin text-soft" strokeWidth={2} />
      </Frame>
    );
  }

  if (report?.unreachable) {
    return (
      <Frame>
        <h1 className="font-serif text-2xl">Can't reach the server</h1>
        <p className="mt-2 text-base leading-relaxed text-muted">
          The page loaded but the part that talks to the model didn't answer. If you're running this
          on your own machine, the dev server may have stopped.
        </p>
      </Frame>
    );
  }

  const { model, accounts, cap } = report;

  return (
    <Frame wide>
      <Mark size={30} className="mb-4 text-accent" />
      <h1 className="font-serif text-3xl font-normal tracking-[-0.02em]">Let's finish setting up</h1>
      <p className="mt-1.5 text-md leading-relaxed text-muted">
        Selflight needs one thing to work, and a second if you want people to sign in. This page
        checks both and tells you what's left.
      </p>

      <div className="mt-8 space-y-3">
        <Step
          n={1}
          done={model.ok}
          title={model.ok ? `${model.provider} key is set` : `Add a ${model.provider} API key`}
        >
          {model.ok ? (
            <>
              <p>
                This is the part that writes the answers. Press the button to send one tiny real
                message and confirm the key actually works — it costs a fraction of a penny.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => check(true)}
                  disabled={testing}
                  className="flex items-center gap-2 rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-page transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.4} />
                  )}
                  Test the connection
                </button>

                {model.live?.ok && (
                  <span className="text-sm font-medium text-accent">
                    Working — replied in {model.live.ms}ms
                  </span>
                )}
              </div>

              {model.live && !model.live.ok && <Problem>{model.live.message}</Problem>}
            </>
          ) : (
            <>
              <p>
                Selflight has no key to write answers with. Getting one takes about two minutes and
                needs a card — you pay per message, and a month of testing runs a few dollars.
              </p>
              <ol className="mt-3 space-y-2">
                <Instruction n="a">
                  Go to{" "}
                  <Link href="https://console.perplexity.ai">
                    console.perplexity.ai
                  </Link>{" "}
                  and sign in.
                </Instruction>
                <Instruction n="b">
                  Open the <b>Billing</b> tab, add a card, and <b>Buy Credits</b> — $20 is plenty.
                  Leave <b>Automatic Top Up</b> switched <b>off</b>: then $20 is the absolute most
                  this can ever cost you. When it runs out the key stops working, which is the
                  failure you want.
                </Instruction>
                <Instruction n="c">
                  Open the <b>API Keys</b> tab → <b>Generate API Key</b>. Copy what appears. It
                  starts with{" "}
                  <code className="rounded bg-codebg px-1 py-0.5 font-mono text-2xs">pplx-</code> and
                  it is shown once and never again.
                </Instruction>
                <Instruction n="d">
                  Put it where this app is hosted, as a setting named{" "}
                  <code className="rounded bg-codebg px-1 py-0.5 font-mono text-2xs">
                    {model.keyName}
                  </code>
                  . On Vercel that's <b>Settings → Environment Variables</b>. Then redeploy.
                </Instruction>
              </ol>
            </>
          )}
        </Step>

        <Step
          n={2}
          done={accounts.state === "ok"}
          optional={accounts.state === "off"}
          title={
            accounts.state === "ok"
              ? "Accounts are working"
              : accounts.state === "off"
                ? "Accounts — not set up yet"
                : "Accounts need fixing"
          }
        >
          <Accounts accounts={accounts} cap={cap} />
        </Step>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <button
          onClick={() => check(false)}
          className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-base font-medium transition-colors hover:border-soft"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
          Check again
        </button>

        {report.ready && onDone && (
          <button
            onClick={onDone}
            className="rounded-lg bg-ink px-4 py-2 text-base font-semibold text-page transition-opacity hover:opacity-90"
          >
            Start using Selflight
          </button>
        )}

        <span className="text-sm text-soft">
          Changed a setting where this is hosted? Redeploy first, then check again.
        </span>
      </div>
    </Frame>
  );
}

function Accounts({ accounts, cap }) {
  if (accounts.state === "off") {
    return (
      <>
        <p>
          Selflight works fine without this — but everything stays in whichever browser you're using,
          there's no sign-in, and anyone who finds the address can spend your credit. Set this up
          before sharing the link with anyone.
        </p>
        <ol className="mt-3 space-y-2">
          <Instruction n="a">
            Make a free project at <Link href="https://supabase.com">supabase.com</Link>.
          </Instruction>
          <Instruction n="b">
            Open <b>SQL Editor</b>, paste in the contents of{" "}
            <code className="rounded bg-codebg px-1 py-0.5 font-mono text-2xs">
              supabase/migrations/0001_init.sql
            </code>{" "}
            from the project, and press <b>Run</b>.
          </Instruction>
          <Instruction n="c">
            From <b>Project Settings → API</b>, copy three values into your hosting settings:{" "}
            <Var>VITE_SUPABASE_URL</Var>, <Var>VITE_SUPABASE_ANON_KEY</Var>, and{" "}
            <Var>SUPABASE_SERVICE_ROLE_KEY</Var>. Never put{" "}
            <code className="rounded bg-codebg px-1 py-0.5 font-mono text-2xs">VITE_</code> in front
            of that last one — it's the key that can read everything.
          </Instruction>
          <Instruction n="d">
            In <b>Authentication → URL Configuration</b>, set <b>Site URL</b> to this page's address.
          </Instruction>
        </ol>
      </>
    );
  }

  if (accounts.missing) {
    return (
      <Problem>
        <p className="font-medium">
          {accounts.missing.length} of the three Supabase settings {accounts.missing.length === 1 ? "is" : "are"} missing:
        </p>
        <ul className="mt-1.5 space-y-0.5">
          {accounts.missing.map((name) => (
            <li key={name}>
              <Var>{name}</Var>
            </li>
          ))}
        </ul>
        <p className="mt-2">All three are on one page: Supabase → Project Settings → API.</p>
      </Problem>
    );
  }

  if (accounts.sameKey) {
    return (
      <Problem>
        The public key and the secret key are set to the same value. They're two different keys on
        the same Supabase page — the secret one is labelled <b>service_role</b> and hidden until you
        click to reveal it.
      </Problem>
    );
  }

  if (accounts.mismatched) {
    return (
      <Problem>
        <p>
          {accounts.mismatched.map((n) => <Var key={n}>{n}</Var>)} belongs to a different Supabase
          project than the URL does.
        </p>
        <p className="mt-2">
          This is the one that looks like a broken sign-in rather than a settings problem. Copy the
          URL and both keys again from the same project's <b>Settings → API</b> page.
        </p>
      </Problem>
    );
  }

  if (accounts.tables && accounts.tables.found < accounts.tables.total) {
    return (
      <Problem>
        <p>
          Selflight found {accounts.tables.found} of {accounts.tables.total} tables it needs. The
          database setup didn't run, or ran on a different project.
        </p>
        <p className="mt-2">
          Open Supabase → <b>SQL Editor</b> → <b>New query</b>, paste all of{" "}
          <code className="rounded bg-codebg px-1 py-0.5 font-mono text-2xs">
            supabase/migrations/0001_init.sql
          </code>{" "}
          and press <b>Run</b>. It's safe to run more than once.
        </p>
      </Problem>
    );
  }

  if (accounts.exposed?.length) {
    return (
      <Problem urgent>
        <p className="font-semibold">Private data is readable by anyone.</p>
        <p className="mt-1.5">
          The public key — which is inside every browser that loads this page — can read{" "}
          {accounts.exposed.join(", ")}. The security rules aren't in place.
        </p>
        <p className="mt-2">
          Re-run the whole of{" "}
          <code className="rounded bg-codebg px-1 py-0.5 font-mono text-2xs">
            supabase/migrations/0001_init.sql
          </code>
          . Don't share this address until this check passes.
        </p>
      </Problem>
    );
  }

  return (
    <>
      <p>
        All {accounts.tables.total} tables are there, and the public key can't read anyone's data
        without signing in — which is the check that matters.
      </p>
      <p className="mt-2 text-muted">
        {accounts.accounts} account{accounts.accounts === 1 ? "" : "s"} so far ·{" "}
        {accounts.tokensThisMonth.toLocaleString()} tokens used this month · limit{" "}
        {cap ? `${cap.toLocaleString()} per person per month` : "none set"}
      </p>
      {accounts.schemaCurrent === false && (
        <Problem urgent>
          <p className="font-semibold">This database is behind the app.</p>
          <p className="mt-1.5">
            public.messages is missing {(accounts.missingColumns || []).join(", ")}, so messages
            can't be saved or loaded — chats appear in the sidebar but open empty.
          </p>
          <p className="mt-2">
            Open Supabase → <b>SQL Editor</b> and run{" "}
            <code className="rounded bg-codebg px-1 py-0.5 font-mono text-2xs">
              supabase/migrations/0002_repair.sql
            </code>
            . It's safe to run twice and won't touch your existing chats.
          </p>
        </Problem>
      )}
    </>
  );
}

/* --------------------------------- pieces -------------------------------- */

function Frame({ children, wide }) {
  return (
    <div className="thin-scrollbar h-full overflow-y-auto bg-page">
      <div className={`mx-auto px-6 py-14 ${wide ? "max-w-[46rem]" : "max-w-[26rem]"}`}>
        {children}
      </div>
    </div>
  );
}

function Step({ n, title, done, optional, children }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${
            done
              ? "bg-accent text-page"
              : optional
                ? "border border-line text-soft"
                : "bg-ink text-page"
          }`}
        >
          {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-md font-semibold">{title}</h2>
          <div className="mt-1.5 space-y-2 text-base leading-relaxed text-muted">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Instruction({ n, children }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 font-mono text-sm text-soft">{n}.</span>
      <span>{children}</span>
    </li>
  );
}

function Problem({ children, urgent }) {
  return (
    <div
      className={`mt-3 rounded-xl border px-3.5 py-3 text-base leading-relaxed ${
        urgent ? "border-accent bg-accent/8 text-ink" : "border-line bg-page text-muted"
      }`}
    >
      <div className="flex gap-2.5">
        <AlertCircle
          className={`mt-0.5 h-4 w-4 shrink-0 ${urgent ? "text-accent" : "text-soft"}`}
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function Var({ children }) {
  return (
    <code className="rounded bg-codebg px-1.5 py-0.5 font-mono text-2xs text-ink">{children}</code>
  );
}

function Link({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-accent underline decoration-accent/30 underline-offset-[3px] hover:decoration-accent"
    >
      {children}
      <ExternalLink className="h-3 w-3" strokeWidth={2} />
    </a>
  );
}
