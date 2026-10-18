import Link from "next/link";
import type { ReactNode } from "react";

/** Page title block: back link, title, one line of context, and the page's actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 sm:mb-8">
      {back && (
        <Link
          href={back.href}
          className="mb-3 inline-flex min-h-10 items-center gap-1.5 rounded-full text-sm font-medium text-ink-500 hover:text-ink-900"
        >
          <span aria-hidden>←</span> {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{eyebrow}</p>}
          <h1 className="font-display text-3xl leading-tight text-ink-900 sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-base text-ink-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled block inside a page. `actions` sit on the heading row. */
export function Section({
  title,
  description,
  actions,
  id,
  className = "",
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-24 ${className}`.trim()}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="font-display text-xl text-ink-900 sm:text-2xl">{title}</h2>}
            {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Nothing here yet: say so, say why, and offer the one next step. */
export function EmptyState({ title, body, action, icon }: { title: ReactNode; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white/60 px-6 py-10 text-center">
      {icon && (
        <div aria-hidden className="mb-3 text-3xl">
          {icon}
        </div>
      )}
      <p className="font-semibold text-ink-900">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** One number with its label. `hint` says where it comes from or what it's measured against. */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "success" | "warn" | "danger";
}) {
  const valueTone = { neutral: "text-ink-900", success: "text-emerald-800", warn: "text-amber-800", danger: "text-red-700" }[tone];
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
