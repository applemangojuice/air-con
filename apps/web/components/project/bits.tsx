"use client";

import type { ReactNode } from "react";
import { STAGE_INFO, type ProjectStageId, type StageState } from "@aircon/domain";

/** Wrapper for every stage detail panel, with the future-preview treatment. */
export function StagePanel({
  stage,
  state,
  children,
}: {
  stage: ProjectStageId;
  state: StageState;
  children: ReactNode;
}) {
  const info = STAGE_INFO[stage];
  return (
    <section className="rounded-3xl border border-line bg-white p-5 sm:p-7">
      {state === "upcoming" && (
        <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-500">
          <span aria-hidden>🔭</span> Coming up: a sneak peek of this step
        </p>
      )}
      {state === "complete" && (
        <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-sage-50 px-3 py-1 text-xs font-semibold text-sage-700">
          ✓ Done
        </p>
      )}
      <h2 className="text-xl font-display sm:text-2xl">{info.title}</h2>
      <p className="mt-1.5 text-sm text-ink-500">{info.strap}</p>
      <div className={`mt-5 space-y-5 ${state === "upcoming" ? "opacity-90" : ""}`}>{children}</div>
    </section>
  );
}

/** "What happens here" bullets, the explanation future stages open with. */
export function Explainer({ stage }: { stage: ProjectStageId }) {
  return (
    <ul className="space-y-2 rounded-2xl bg-surface/60 p-4 text-sm text-ink-700">
      {STAGE_INFO[stage].explainer.map((line) => (
        <li key={line} className="flex gap-2.5">
          <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

export function LockedNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-ink-500">
      <span aria-hidden>🔒</span>
      <span>{children}</span>
    </p>
  );
}

export function PrimaryButton({
  onClick,
  disabled,
  busy,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="w-full rounded-full bg-accent-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:min-w-56"
    >
      {busy ? "One moment…" : children}
    </button>
  );
}

export function GhostButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-700 transition hover:bg-surface disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="text-right font-semibold">{children}</span>
    </div>
  );
}

export const dateInputCls =
  "rounded-full border border-line bg-white px-4 py-2.5 text-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100 disabled:opacity-40";
