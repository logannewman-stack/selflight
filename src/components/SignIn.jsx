import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import Logo from "./Logo.jsx";
import { friendlyAuthError, supabase } from "../lib/supabase.js";

// Signing in, laid out for the hand holding the phone.
//
// The old version centred everything vertically, which reads well on a laptop
// and badly on a phone: the button lands mid-screen, above where a thumb rests,
// and the on-screen keyboard covers whatever was under it. So on a small screen
// this is bottom-weighted — heading at the top, fields and button down where the
// thumb already is — and only becomes a centred card once there's room for one.
//
// The rest is the unglamorous list that decides whether signing in on a phone is
// pleasant or maddening: 16px inputs so iOS doesn't zoom the page on focus, the
// right autocomplete and inputMode so the keyboard opens on the right layout and
// the password manager offers to fill, 44px touch targets, and safe-area padding
// so nothing sits under the home indicator.

// Password and magic link, both. A password gives an answer immediately, which
// is what you want while testing; a link is what you want when you've forgotten
// the password. Neither is more "real" than the other to Supabase.
//
// `reset` is the third: a link that lets somebody *change* the password rather
// than get in around it. A magic link already gets a forgetful person into
// their account, but it leaves the forgotten password in place, so they're
// locked out again next time and the app looks broken.
const MODES = {
  in: {
    title: "Welcome back",
    blurb: "Sign in to pick up where you left off.",
    action: "Sign in",
    swap: "Create an account",
    next: "up"
  },
  up: {
    title: "Create your account",
    blurb: "Free to start. No card, no trial countdown.",
    action: "Create account",
    swap: "I already have an account",
    next: "in"
  },
  link: {
    title: "Sign in with a link",
    blurb: "We'll email you a link. No password to remember.",
    action: "Email me a link",
    swap: "Use a password instead",
    next: "in"
  },
  reset: {
    title: "Reset your password",
    blurb: "Tell us the address on the account and we'll email a link to set a new password.",
    action: "Email me a reset link",
    swap: "Back to sign in",
    next: "in"
  },
  // Reached from the emailed link rather than from a button, which is why it
  // has no `swap`: there is nowhere else to go until the password is set.
  recover: {
    title: "Set a new password",
    blurb: "Choose something you'll remember. You're already signed in — this replaces the old one.",
    action: "Save new password",
    swap: null,
    next: "in"
  }
};

export default function SignIn({ onBack, recovery = false, notice = null, onRecovered }) {
  // `recovery` is not a mode somebody can navigate to — it's where the emailed
  // link lands, and the only way out is setting a password.
  //
  // `notice` is the other half of that arrival: the link was a reset link and
  // it didn't work, usually because it had expired or had already been used.
  // Opening on `reset` with the reason on screen means the next thing they see
  // is the button that sends a fresh one — rather than a sign-in form that
  // gives no hint why the link they just clicked did nothing.
  const [mode, setMode] = useState(recovery ? "recover" : notice ? "reset" : "in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // Through the same translator as every other failure, so an expired link
  // reads the same whether it was caught in the URL or thrown on submit.
  const [error, setError] = useState(() => (notice ? friendlyAuthError({ message: notice }) : null));
  const [sent, setSent] = useState(null);
  // Whichever field comes first in this mode — the email box everywhere except
  // recovery, where there isn't one.
  const firstRef = useRef(null);

  const copy = MODES[mode];

  // Focused only where a keyboard is already on screen. Autofocusing on a phone
  // throws the keyboard up over the page before anyone has read what they're
  // signing into.
  useEffect(() => {
    if (window.matchMedia?.("(min-width: 640px)").matches) firstRef.current?.focus();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      if (mode === "recover") {
        if (password.length < 6) throw new Error("Password should be at least 6 characters.");
        const { error: err } = await supabase.auth.updateUser({ password });
        if (err) throw err;
        // They're already signed in — the recovery link did that. All this
        // needs to do is hand the app back.
        onRecovered?.();
      } else if (mode === "reset") {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin
        });
        if (err) throw err;
        // Said the same way whether or not the address has an account. Anything
        // else turns this box into a way to find out who has one.
        setSent("If that address has an account, a link to set a new password is on its way.");
      } else if (mode === "link") {
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
      <Frame onBack={onBack}>
        {/* Short enough to centre rather than bottom-weight: there's nothing
            here to type, so nothing that needs to be near a thumb. */}
        <div className="my-auto sm:my-0">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/12 text-accent">
          <Check className="h-6 w-6" strokeWidth={2.4} />
        </div>
        <h1 className="mt-5 font-serif text-3xl font-normal tracking-[-0.02em]">Check your email</h1>
        <p className="mt-2.5 text-base leading-relaxed text-muted">{sent}</p>
        <p className="mt-1 break-all text-base text-soft">Sent to {email}.</p>
        <button
          onClick={() => go("in")}
          className="mt-7 flex min-h-[44px] items-center gap-2 text-base font-medium text-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
          Back to sign in
        </button>
        </div>
      </Frame>
    );
  }

  // Per mode, because the two new ones don't want the same pair as the old
  // ones. Recovery has no email box at all — the link that got them here has
  // already signed them in — so a blanket `email.trim() &&` would leave its
  // button disabled forever, on the one screen with no way back out.
  const wantsEmail = mode !== "recover";
  const wantsPassword = mode !== "link" && mode !== "reset";
  const ready = (!wantsEmail || email.trim()) && (!wantsPassword || password);
  // Both of these send an email and wait rather than answering now.
  const posts = mode === "link" || mode === "reset";

  return (
    <Frame onBack={onBack}>
      <Logo size={30} />

      <h1 className="mt-6 font-serif text-3xl font-normal leading-tight tracking-[-0.02em]">
        {copy.title}
      </h1>
      <p className="mt-2 text-base leading-relaxed text-muted">{copy.blurb}</p>

      {/* The half that moves. `mt-auto` drops the fields and the button to the
          bottom of a phone screen — thumb reach, and above the keyboard — while
          the heading above stays where it was read. On a card there's no spare
          space to distribute, so it goes back to being a margin. */}
      <form onSubmit={submit} className="mt-auto space-y-3 pt-8 sm:mt-0 sm:pt-7">
        {wantsEmail && (
          <Field
            ref={firstRef}
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            label="Email"
            // The three that decide whether a phone keyboard is helpful or
            // hostile: an @ key, no capital first letter, no autocorrect
            // rewriting the address as it's typed.
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint={posts ? "send" : "next"}
          />
        )}

        {wantsPassword && (
          <Field
            ref={wantsEmail ? undefined : firstRef}
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={setPassword}
            placeholder="At least six characters"
            label={mode === "recover" ? "New password" : "Password"}
            // A password manager offers to *save* on `new-password` and to fill
            // on `current-password`. Getting this wrong on the recovery screen
            // means the manager keeps the password that just stopped working.
            autoComplete={mode === "up" || mode === "recover" ? "new-password" : "current-password"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            // Typing a password blind on a phone keyboard is how people end up
            // locked out of an account they just created.
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-soft transition-colors hover:text-ink"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={2} />
                )}
              </button>
            }
          />
        )}

        {error && (
          <p role="alert" className="text-base leading-relaxed text-accent">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !ready}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-md font-semibold text-page transition-opacity hover:opacity-90 active:scale-[0.99] disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.4} />
          ) : (
            <>
              {copy.action}
              {posts ? (
                <Mail className="h-4 w-4" strokeWidth={2.2} />
              ) : (
                <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
              )}
            </>
          )}
        </button>
      </form>

      {/* The other ways in, in one place rather than scattered around the form.
          Forgetting a password is the first thing that goes wrong here, so it
          leads — it sits directly under the button that just refused, which is
          where somebody is already looking.

          Hidden entirely during recovery: every route here leaves without
          setting the password they came to set, and they'd be locked out again
          the next time with the app looking like it had worked. */}
      {mode !== "recover" && (
        <div className="mt-6 flex flex-col gap-1 border-t border-line pt-4 text-base">
          {mode === "in" && (
            <button
              onClick={() => go("reset")}
              className="flex min-h-[44px] items-center font-medium text-muted transition-colors hover:text-ink"
            >
              Forgot your password?
            </button>
          )}
          {copy.swap && (
            <button
              onClick={() => go(copy.next)}
              className="flex min-h-[44px] items-center font-medium text-muted transition-colors hover:text-ink"
            >
              {copy.swap}
            </button>
          )}
          {mode !== "link" && (
            <button
              onClick={() => go("link")}
              className="flex min-h-[44px] items-center text-muted transition-colors hover:text-ink"
            >
              Email me a sign-in link instead
            </button>
          )}
        </div>
      )}
    </Frame>
  );
}

/* --------------------------------- layout --------------------------------- */

// Two layouts from one tree.
//
// On a phone the column fills the screen: the name and the heading sit at the
// top where they're read once, and the form carries `mt-auto` so the fields and
// the button fall to the bottom, within thumb reach and above the keyboard. An
// earlier version pushed the whole block down together, which was ergonomically
// right and left the top half of the screen empty.
//
// Once there's room for a card it becomes one — centred, on a surface, with the
// same faint accent light as the landing page behind it, so the two screens
// read as one product rather than a pitch and a form somebody else wrote.
function Frame({ children, onBack }) {
  return (
    <div
      className="relative flex h-full flex-col overflow-y-auto px-6 sm:items-center sm:justify-center"
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(2rem, env(safe-area-inset-bottom))"
      }}
    >
      <div
        aria-hidden
        // On a phone this lands in the space the bottom-weighted layout opens up
        // between the heading and the fields, which is otherwise a large blank.
        className="pointer-events-none absolute left-1/2 top-1/2 h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.06]"
        style={{
          background: "radial-gradient(circle, rgb(var(--accent)) 0%, transparent 62%)"
        }}
      />

      {onBack && (
        <button
          onClick={onBack}
          // `muted`, not `soft`: this is a control, and `soft` is the tier
          // reserved for placeholders — around 3.3:1 on the light palettes,
          // under the floor for 13.5px text.
          className="relative mb-2 flex min-h-[44px] w-fit items-center gap-1.5 text-base font-medium text-muted transition-colors hover:text-ink sm:absolute sm:left-6 sm:top-6 sm:mb-0"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.2} />
          Back
        </button>
      )}

      {/* flex-1 so the column can distribute space on a phone; flex-none hands
          that back once it's a card and should be exactly as tall as it is. */}
      <div className="relative flex w-full max-w-[380px] flex-1 flex-col sm:max-w-[404px] sm:flex-none sm:rounded-3xl sm:border sm:border-line sm:bg-surface sm:p-9 sm:shadow-lg">
        {children}
      </div>
    </div>
  );
}

/* --------------------------------- a field -------------------------------- */

const Field = React.forwardRef(function Field(
  { label, hint, value, onChange, trailing, ...rest },
  ref
) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      <span className="relative flex items-center">
        <input
          {...rest}
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // A height rather than padding: 52px is comfortable for a thumb, and
          // 44px is the floor below which people start missing. `text-md` is
          // 15px on this scale — the app's `text-base` is 13.5px, which is too
          // small to read back an email address you've just typed. On a phone
          // the coarse-pointer rule in index.css lifts it to 16px, which is
          // what stops Safari zooming the page on focus.
          className={`w-full rounded-xl border border-line bg-surface px-3.5 text-md outline-none transition-colors placeholder:text-soft focus:border-soft ${
            trailing ? "pr-12" : ""
          }`}
          style={{ minHeight: "52px" }}
        />
        {trailing && <span className="absolute right-1">{trailing}</span>}
      </span>
      {hint && <span className="mt-1 block text-sm text-soft">{hint}</span>}
    </label>
  );
});
