"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A bottom sheet for the phone (a centred panel on wider screens): a real
 * modal dialog with a title, Escape and the backdrop to close, focus moved
 * in on open and back to the opener on close, and the page behind kept
 * still. Big close target for gloved thumbs.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], button, [href], input, select, textarea");
      (first ?? panel.current)?.focus();
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        const nodes = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")];
        if (!nodes.length) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-ink-950/45" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        {...(description ? { "aria-describedby": `${id}-desc` } : {})}
        tabIndex={-1}
        className={`relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-cream shadow-2xl outline-none sm:rounded-3xl ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="font-display text-2xl leading-tight text-ink-900">
              {title}
            </h2>
            {description && (
              <p id={`${id}-desc`} className="mt-1 text-sm text-ink-500">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-ink-700 hover:bg-surface"
            aria-label="Close"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line bg-white/80 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Render children into a slot the field layout provides (the header title, the sync badge). */
export function SlotPortal({ slot, children }: { slot: "field-header-title" | "field-sync-badge"; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  // After mount only: the slot is empty in the server HTML, so hydration matches.
  useEffect(() => setTarget(document.getElementById(slot)), [slot]);
  return target ? createPortal(children, target) : null;
}
