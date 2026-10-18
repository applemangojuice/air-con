"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { Blocker, StageInfo, StageState } from "@aircon/domain";
import { STAFF_READ_ONLY, canAct, useHub } from "./controller";
import type { PersonCard, PortalRequest } from "./types";

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/**
 * One button's request lifecycle: busy while it runs, then either the
 * server's own message or its refusal, said where the button is.
 */
export function useAction() {
  const hub = useHub();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ text: string; steps: string[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const readOnly = !canAct(hub);
  // The refusal, with any steps that are the customer's own to take (from the gate's blockers).
  const setError = useCallback((text: string | null, blockers?: Blocker[]) => {
    setFailure(
      text
        ? {
            text,
            steps: (blockers ?? [])
              .filter((b) => b.severity === "block" && b.owner === "customer")
              .map((b) => (b.action ? `${b.message} ${b.action}.` : b.message)),
          }
        : null,
    );
  }, []);
  const error: ReactNode = failure ? (
    failure.steps.length ? (
      <>
        {failure.text}
        <ul className="mt-1.5 list-disc pl-5 font-normal">
          {failure.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </>
    ) : (
      failure.text
    )
  ) : null;

  const run = useCallback(
    async (req: PortalRequest): Promise<boolean> => {
      if (readOnly) {
        setError(STAFF_READ_ONLY);
        return false;
      }
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const result = await hub.request(req);
        if (result.ok) {
          setMessage(result.message ?? null);
          return true;
        }
        setError(result.error, result.blockers);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [hub, readOnly, setError],
  );

  const clear = useCallback(() => {
    setError(null);
    setMessage(null);
  }, [setError]);

  return { run, busy, error, message, readOnly, clear };
}

/** The outcome of an action, announced. Errors interrupt; confirmations wait their turn. */
export function ActionFeedback({ error, message, className = "" }: { error?: ReactNode; message?: string | null; className?: string }) {
  return (
    <div aria-live="polite" className={className}>
      {error && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error}
        </p>
      )}
      {!error && message && (
        <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {message}
        </p>
      )}
    </div>
  );
}

/** Shown in place of the customer's controls when the team is looking. */
export function ReadOnlyNote() {
  const hub = useHub();
  if (canAct(hub)) return null;
  return <p className="rounded-2xl border border-dashed border-line bg-surface/60 px-4 py-3 text-sm text-ink-700">{STAFF_READ_ONLY}</p>;
}

/* ------------------------------------------------------------------ */
/* Stage panel                                                         */
/* ------------------------------------------------------------------ */

const STATE_CHIP: Record<StageState, { label: string; cls: string }> = {
  complete: { label: "Done", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  current: { label: "Now", cls: "border-accent-100 bg-accent-50 text-accent-700" },
  upcoming: { label: "Coming up", cls: "border-line bg-surface text-ink-700" },
};

/** Every stage panel: title, where it stands, the strap, then its content. */
export function StageShell({ info, state, children }: { info: StageInfo; state: StageState; children: ReactNode }) {
  const chip = STATE_CHIP[state];
  return (
    <section aria-labelledby={`stage-${info.id}-title`} className="rounded-3xl border border-line bg-white p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`stage-${info.id}-title`} className="font-display text-2xl leading-tight text-ink-900 sm:text-[28px]">
          {info.title}
        </h2>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chip.cls}`}>{chip.label}</span>
      </div>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-500">{info.strap}</p>
      <div className="mt-6 space-y-6">{children}</div>
    </section>
  );
}

/** "What happens here": the plain-English bullets every stage carries. */
export function Explainer({ info, title = "What happens at this stage" }: { info: StageInfo; title?: string }) {
  return (
    <div className="rounded-2xl bg-surface/70 p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      <ul className="mt-2.5 space-y-2.5 text-[15px] leading-relaxed text-ink-700">
        {info.explainer.map((line) => (
          <li key={line} className="flex gap-2.5">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A control that isn't open yet, and what opens it. */
export function Locked({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-ink-700">
      <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0 text-ink-500" fill="none">
        <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

/** Small heading inside a panel. */
export function Sub({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="text-base font-semibold text-ink-900">
      {children}
    </h3>
  );
}

/** Label on the left, fact on the right; wraps cleanly on a phone. */
export function InfoRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-[15px]">
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 text-right font-semibold text-ink-900">{children}</dd>
    </div>
  );
}

export function InfoList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-line rounded-2xl border border-line bg-white px-4">{children}</dl>;
}

/** A calm callout. Tones: info (blue), good (green), heads-up (amber), you (orange: their move). */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
}: {
  tone?: "info" | "good" | "warn" | "you";
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  const cls = {
    info: "border-sage-200 bg-sage-50 text-sage-900",
    good: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    you: "border-accent-100 bg-accent-50 text-ink-900",
  }[tone];
  return (
    <div className={`flex gap-3 rounded-2xl border px-4 py-3.5 ${cls}`}>
      {icon && (
        <span aria-hidden className="mt-0.5 shrink-0">
          {icon}
        </span>
      )}
      <div className="min-w-0 text-[15px] leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
    </div>
  );
}

/** A checklist of plain items (what we'll check, what to prepare). */
export function Checklist({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-[15px] leading-relaxed text-ink-700">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5">
          <svg aria-hidden width="18" height="18" viewBox="0 0 18 18" className="mt-0.5 shrink-0 text-sage-500" fill="none">
            <circle cx="9" cy="9" r="8" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5.5 9.2 7.8 11.5 12.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && w !== "DEMO")
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export function Avatar({ name, url, size = 56 }: { name: string; url: string | null; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URLs
    return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-sage-100 font-semibold text-sage-800"
      style={{ width: size, height: size, fontSize: size / 2.8 }}
    >
      {initials(name)}
    </span>
  );
}

/** Who's coming: face, name, role, the qualifications they actually hold today, and a line about them. */
export function PersonCardView({ person }: { person: PersonCard }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-line bg-white p-4">
      <Avatar name={person.name} url={person.photoUrl} />
      <div className="min-w-0">
        <p className="font-semibold text-ink-900">{person.name}</p>
        <p className="text-sm text-ink-500">{person.role}</p>
        {person.qualifications.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Qualifications held">
            {person.qualifications.map((q) => (
              <li key={q} className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                {q}
              </li>
            ))}
          </ul>
        )}
        {person.bio && <p className="mt-2 text-sm leading-relaxed text-ink-700">{person.bio}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

const PRIMARY =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 py-3 text-base font-semibold text-ink-900 transition hover:border-ink-300 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50";

export const primaryCls = (block = true) => `${PRIMARY} ${block ? "w-full sm:w-auto" : ""}`;
export const secondaryCls = (block = true) => `${SECONDARY} ${block ? "w-full sm:w-auto" : ""}`;

export function Primary({
  onClick,
  disabled,
  busy,
  busyLabel = "One moment…",
  type = "button",
  children,
  block = true,
}: {
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  type?: "button" | "submit";
  children: ReactNode;
  block?: boolean;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined} className={primaryCls(block)}>
      {busy ? busyLabel : children}
    </button>
  );
}

export function Secondary({
  onClick,
  disabled,
  children,
  block = true,
  type = "button",
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  block?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={secondaryCls(block)}>
      {children}
    </button>
  );
}

/** A plain text link-button for secondary moves ("Change", "Cancel"). */
export function TextButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-11 items-center rounded-full px-1 text-sm font-semibold text-accent-700 underline underline-offset-2 hover:text-accent-600 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
