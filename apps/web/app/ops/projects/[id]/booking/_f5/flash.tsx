"use client";

import { useEffect, useState } from "react";

/**
 * Says what just happened when the form that did it has gone from the page
 * (an issued invoice's card, a paid invoice, a confirmed booking): an
 * ActionForm with `flash` sends its result here, shown as a toast at the
 * bottom of the screen wherever the page is scrolled. Successes fade after
 * a few seconds; warnings stay until dismissed.
 */

export const FLASH_EVENT = "f5:flash";

export interface FlashDetail {
  message?: string;
  warning?: string;
}

export function flash(detail: FlashDetail): void {
  window.dispatchEvent(new CustomEvent<FlashDetail>(FLASH_EVENT, { detail }));
}

export function FlashRegion() {
  const [current, setCurrent] = useState<(FlashDetail & { at: number }) | null>(null);
  useEffect(() => {
    const on = (e: Event) => setCurrent({ ...(e as CustomEvent<FlashDetail>).detail, at: Date.now() });
    window.addEventListener(FLASH_EVENT, on);
    return () => window.removeEventListener(FLASH_EVENT, on);
  }, []);
  useEffect(() => {
    if (!current || current.warning) return;
    const t = setTimeout(() => setCurrent(null), 7000);
    return () => clearTimeout(t);
  }, [current]);
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      {current && (current.message || current.warning) && (
        <div
          className={`pointer-events-auto flex w-full max-w-lg items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg ${
            current.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          <div>
            {current.message && <p>{current.message}</p>}
            {current.warning && <p className={current.message ? "mt-1" : ""}>{current.warning}</p>}
          </div>
          <button type="button" onClick={() => setCurrent(null)} className="-my-1 min-h-9 min-w-9 shrink-0 rounded-full hover:bg-black/5" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
