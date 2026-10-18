import Link from "next/link";
import type { ReactNode } from "react";
import { StatusChip } from "@/components/kit/badge";

/**
 * Presentational pieces of the command centre (server-safe: no hooks).
 */

/** One stage's card: title, status, the facts, and its one primary link. */
export function SectionCard({
  id,
  title,
  status,
  statusLabel,
  primary,
  children,
  className = "",
}: {
  id: string;
  title: string;
  status?: string;
  statusLabel?: string;
  primary?: { href: string; label: string; note?: string };
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-24 rounded-2xl border border-line bg-white p-4 sm:p-5 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="font-display text-lg text-ink-900">
          {title}
        </h2>
        {status && <StatusChip status={status} label={statusLabel} />}
      </div>
      <div className="mt-3 space-y-3 text-sm text-ink-700">{children}</div>
      {primary && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3">
          <Link href={primary.href} className="inline-flex min-h-10 items-center gap-1 rounded-full text-sm font-semibold text-accent-700 hover:text-accent-600">
            {primary.label} <span aria-hidden>→</span>
          </Link>
          {primary.note && <span className="text-xs text-ink-500">{primary.note}</span>}
        </div>
      )}
    </section>
  );
}

/** Label / value pairs, two columns where there's room. Missing values say so. */
export function Facts({ items }: { items: [ReactNode, ReactNode | null | undefined][] }) {
  return (
    <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1.5">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-ink-500">{k}</dt>
          <dd className="min-w-0 break-words text-ink-900">{v ?? <span className="text-ink-500">Not yet</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A quiet line for "nothing here yet" inside a card. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-500">{children}</p>;
}

/** A coloured note inside a card: warn for "needs doing", danger for "blocked". */
export function Note({ tone = "warn", children }: { tone?: "warn" | "danger" | "info" | "success"; children: ReactNode }) {
  const cls = {
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    info: "border-sage-200 bg-sage-50 text-sage-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div className={`rounded-xl border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

/**
 * A stored message's body: email HTML in a fully sandboxed frame (no
 * scripts, no same-origin, no navigation out), SMS as plain text.
 */
export function MessageBody({ html, text, subject }: { html?: string; text: string; subject?: string }) {
  return (
    <div className="mt-2 space-y-2">
      {subject && (
        <p className="text-sm">
          <span className="text-ink-500">Subject: </span>
          <span className="font-semibold text-ink-900">{subject}</span>
        </p>
      )}
      {html ? (
        <iframe
          title={subject ? `Email preview: ${subject}` : "Message preview"}
          sandbox=""
          srcDoc={html}
          referrerPolicy="no-referrer"
          className="h-96 w-full rounded-xl border border-line bg-white"
        />
      ) : (
        <pre className="whitespace-pre-wrap break-words rounded-xl border border-line bg-surface p-3 font-sans text-sm text-ink-900">{text}</pre>
      )}
    </div>
  );
}
