import React, { useState } from "react";
import { ArrowRight, Check, Loader2, Mail } from "lucide-react";
import Logo from "./Logo.jsx";
import { friendlyAuthError, supabase } from "../lib/supabase.js";

// Password and magic link, both. A password gives an answer immediately, which
// is what you want while testing; a link is what you want when you've forgotten
// the password. Neither is more "real" than the other to Supabase.
const MODES = {
  in: { title: "Welcome back", action: "Sign in", swap: "Create an account", next: "up" },
  up: { title: "Create your account", action: "Create account", swap: "I already have an account", next: "in" },
  link: { title: "Sign in with a link", action: "Email me a link", swap: "Use a password instead", next: "in" }
};

export default function SignIn() {
  const [mode, setMode] = useState("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  const copy = MODES[mode];

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      if (mode === "link") {
        const { error: err } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin }
        });
        if (err) throw err;
        setSent("Check your email for a sign-in link.");
      } else if (mode === "up") {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        // With email confirmation on, signUp returns a user but no session.
        if (!data.session) setSent("Check your email to confirm the address, then sign in.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
    // A successful sign-in doesn't need to do anything else: App is listening
    // for the auth state change and will swap this screen out.
  };

  const go = (next) => {
    setMode(next);
    setError(null);
    setSent(null);
  };

  if (sent) {
    return (
      <Frame>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/12 text-accent">
          <Check className="h-5 w-5" strokeWidth={2.4} />
        </div>
        <h1 className="mt-5 font-serif text-2xl font-normal tracking-[-0.02em]">Check your email</h1>
        <p className="mt-2 text-base leading-relaxed text-muted">{sent}</p>
        <p className="mt-1 text-base text-soft">Sent to {email}.</p>
        <button
          onClick={() => go("in")}
          className="mt-6 text-base font-medium text-muted transition-colors hover:text-ink"
        >
          Back to sign in
        </button>
      </Frame>
    );
  }

  return (
    <Frame>
      <Logo size={30} />
      <p className="mt-1.5 text-md text-muted">{copy.title}</p>

      <form onSubmit={submit} className="mt-7 space-y-2.5">
        <Field
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          label="Email"
          autoFocus
          autoComplete="email"
        />

        {mode !== "link" && (
          <Field
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            label="Password"
            autoComplete={mode === "up" ? "new-password" : "current-password"}
            hint={mode === "up" ? "At least six characters." : null}
          />
        )}

        {error && (
          <p role="alert" className="pt-0.5 text-base leading-relaxed text-accent">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !email || (mode !== "link" && !password)}
          className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-base font-semibold text-page transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
          ) : (
            <>
              {copy.action}
              {mode === "link" ? (
                <Mail className="h-4 w-4" strokeWidth={2.2} />
              ) : (
                <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
              )}
            </>
          )}
        </button>
      </form>

      <div className="mt-6 flex flex-col items-start gap-2 border-t border-line pt-5 text-base">
        <button onClick={() => go(copy.next)} className="font-medium text-muted transition-colors hover:text-ink">
          {copy.swap}
        </button>
        {mode !== "link" && (
          <button onClick={() => go("link")} className="text-muted transition-colors hover:text-ink">
            Email me a sign-in link instead
          </button>
        )}
      </div>
    </Frame>
  );
}

function Frame({ children }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-[360px]">{children}</div>
    </div>
  );
}

function Field({ label, hint, value, onChange, ...rest }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base outline-none transition-colors placeholder:text-soft focus:border-soft"
      />
      {hint && <span className="mt-1 block text-sm text-soft">{hint}</span>}
    </label>
  );
}
