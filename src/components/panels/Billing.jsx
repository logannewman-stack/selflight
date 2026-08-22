import React, { useEffect, useState } from "react";
import { ArrowUpRight, Check, Loader2 } from "lucide-react";
import { billing as fetchBilling, startCheckout } from "../../lib/api.js";

// The plan, what's left of the month, and what else is for sale.
//
// The number people come here for is "how many messages do I have left", so
// that is the first thing on the screen and it comes from the server — the same
// figure the chat route enforces against. A browser that worked it out from a
// local count would eventually disagree with the thing that actually stops you,
// and the person would be right and the screen would be wrong.

export default function Billing() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    fetchBilling().then((next) => {
      setData(next);
      // Distinguishes "loaded, nothing for sale" from "still loading" — an
      // empty screen that might resolve is worse than one that has answered.
      if (!next) setError("Couldn't read your plan. Reload and try again.");
    });

  useEffect(() => {
    load();
  }, []);

  // Coming back from Stripe, the webhook may not have landed yet. One delayed
  // re-read costs nothing and turns "I paid and it still says Free" into the
  // plan they just bought.
  useEffect(() => {
    if (!/[?&]billing=(success|done)/.test(window.location.search)) return;
    const again = setTimeout(load, 2500);
    // Takes the marker out of the address bar so a refresh doesn't repeat this.
    window.history.replaceState({}, "", window.location.pathname);
    return () => clearTimeout(again);
  }, []);

  const go = async (plan) => {
    setBusy(plan || "portal");
    const message = await startCheckout(plan);
    if (message) {
      setError(message);
      setBusy(null);
    }
    // On success the browser is already on its way to Stripe.
  };

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-base text-muted">
        {error || (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> Reading your plan…
          </span>
        )}
      </div>
    );
  }

  const { plan, plans = [], payments } = data;

  return (
    <div className="thin-scrollbar h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-[46rem]">
        {plan && <Current plan={plan} onManage={() => go(null)} busy={busy === "portal"} />}

        {!payments && (
          <p className="mb-4 rounded-xl border border-line bg-surface p-3 text-base text-muted">
            Payments aren't switched on for this deployment yet, so the plans below can be read but
            not bought. Set <code className="font-mono text-sm">STRIPE_SECRET_KEY</code> and the{" "}
            <code className="font-mono text-sm">STRIPE_PRICE_*</code> variables.
          </p>
        )}

        {error && (
          <p role="alert" className="mb-4 text-base leading-relaxed text-accent">
            {error}
          </p>
        )}

        {plans.length > 0 && (
          <>
            <h2 className="mb-1 mt-6 font-serif text-xl font-normal">
              {plan?.subscribed ? "Other plans" : "Plans"}
            </h2>
            <p className="mb-3 text-base leading-relaxed text-muted">
              A message means one on the Balanced setting.
            </p>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {plans.map((option) => (
                <Plan
                  key={option.id}
                  plan={option}
                  current={option.id === plan?.id}
                  busy={busy === option.id}
                  disabled={Boolean(busy) || !payments || !option.priced}
                  onPick={() => go(option.id)}
                />
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}

/* ------------------------------ what you have ---------------------------- */

function Current({ plan, onManage, busy }) {
  const unlimited = plan.messagesLeft === null;
  const total = plan.messages;
  const left = plan.messagesLeft;
  // Guarded rather than assumed: an unlimited plan has no total to divide by,
  // and a zero would render a NaN-width bar.
  const share = unlimited || !total ? 1 : Math.max(0, Math.min(1, left / total));

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-medium uppercase tracking-[0.1em] text-soft">Your plan</span>
          <h2 className="font-serif text-2xl font-normal">{plan.name}</h2>
        </div>
        {plan.subscribed && (
          <button
            onClick={onManage}
            disabled={busy}
            className="tap flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-base font-medium text-muted transition-colors hover:border-soft hover:text-ink disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
            Change or cancel
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        )}
      </div>

      <p className="mt-3 text-base">
        {unlimited ? (
          <span className="text-muted">No monthly limit — you're paying the model directly.</span>
        ) : (
          <>
            <b className="font-medium">{left.toLocaleString()}</b>
            <span className="text-muted">
              {" "}
              of {total.toLocaleString()} messages left this month
            </span>
          </>
        )}
      </p>

      {!unlimited && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              plan.exceeded ? "bg-accent" : "bg-ink"
            }`}
            style={{ width: `${Math.round(share * 100)}%` }}
          />
        </div>
      )}

      {plan.exceeded && (
        <p className="mt-2.5 text-base leading-relaxed text-accent">
          You've used this month's messages. It resets on the 1st, or you can move up a plan now.
        </p>
      )}

      {plan.until && (
        <p className="mt-2.5 text-base text-muted">
          {/* Only shown after a cancellation, which is the one time the date
              matters — until then it's the renewal date and nobody asked. */}
          Runs until {new Date(plan.until).toLocaleDateString()}.
        </p>
      )}
    </div>
  );
}

/* ------------------------------ what's for sale --------------------------- */

function Plan({ plan, current, busy, disabled, onPick }) {
  return (
    <div
      className={`flex flex-col rounded-2xl border p-4 transition-colors ${
        current ? "border-ink bg-surface" : "border-line bg-surface hover:border-soft"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium">{plan.name}</h3>
        <span className="font-serif text-lg">
          {plan.price}
          {plan.priceCents ? <span className="text-sm text-soft">/mo</span> : null}
        </span>
      </div>

      <p className="mt-1.5 min-h-[2.6em] text-base leading-relaxed text-muted">{plan.blurb}</p>

      <ul className="mt-2.5 space-y-1 text-base text-muted">
        <Feature>
          {plan.messages ? `${plan.messages.toLocaleString()} messages a month` : "No monthly limit"}
        </Feature>
        <Feature>{plan.connectors} connected accounts</Feature>
        <Feature>{plan.deep ? "Deep mode, on the best model" : "Quick and Balanced"}</Feature>
      </ul>

      <button
        onClick={onPick}
        disabled={disabled || current}
        className="tap mt-3.5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 text-base font-semibold text-page transition-opacity hover:opacity-90 disabled:opacity-30"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
        ) : current ? (
          "Your plan"
        ) : !plan.priced ? (
          "Not available"
        ) : (
          `Choose ${plan.name}`
        )}
      </button>
    </div>
  );
}

function Feature({ children }) {
  return (
    <li className="flex items-start gap-1.5">
      <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.4} />
      {children}
    </li>
  );
}

