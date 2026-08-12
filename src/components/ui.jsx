import React from "react";

export function Section({ title, hint, children }) {
  return (
    <section className="border-b border-line px-4 py-5 last:border-b-0">
      <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-soft">{title}</h3>
      {hint && <p className="mt-1.5 text-sm leading-relaxed text-muted">{hint}</p>}
      <div className="mt-3.5 space-y-3.5">{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-[20px] w-[34px] shrink-0 rounded-full p-[2px] transition-colors ${
          checked ? "bg-accent" : "bg-line"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform ${
            checked ? "translate-x-[14px]" : ""
          }`}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-base font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-sm leading-relaxed text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Choice({ label, options, value, onChange }) {
  return (
    <div>
      {label && <p className="mb-2 text-base font-medium">{label}</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              title={option.hint}
              className={`rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-ink text-page"
                  : "bg-surface text-muted ring-1 ring-line hover:text-ink"
              }`}
            >
              {option.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-base font-medium">{label}</span>
      <input
        {...props}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base outline-none placeholder:text-soft focus:border-soft"
      />
      {hint && <span className="mt-1.5 block text-sm leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

export function Area({ label, hint, rows = 4, ...props }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-base font-medium">{label}</span>
      <textarea
        rows={rows}
        {...props}
        className="thin-scrollbar w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-base leading-relaxed outline-none placeholder:text-soft focus:border-soft"
      />
      {hint && <span className="mt-1.5 block text-sm leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

export function Button({ children, variant = "ghost", className = "", ...props }) {
  const styles = {
    solid: "bg-ink text-page hover:opacity-90 disabled:opacity-30",
    ghost: "bg-surface text-ink ring-1 ring-line hover:border-soft disabled:opacity-40",
    quiet: "text-muted hover:text-ink disabled:opacity-40"
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-base font-medium transition-colors ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="px-6 py-14 text-center">
      {Icon && <Icon className="mx-auto mb-3 h-5 w-5 text-soft" strokeWidth={1.8} />}
      <p className="text-base font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[260px] text-sm leading-relaxed text-muted">
        {children}
      </p>
    </div>
  );
}
