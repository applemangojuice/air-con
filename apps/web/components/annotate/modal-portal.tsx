"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders a dialog at the end of <body> and makes everything else inert
 * while it's open, so focus, taps and screen readers stay inside it (a real
 * modal, not just one drawn on top). Children mount only once the host
 * exists, so their effects can measure and focus. On close the page is
 * restored as it was: inert removed, scrolling back, focus returned to
 * whatever opened it.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = document.createElement("div");
    el.setAttribute("data-modal-host", "");
    document.body.appendChild(el);
    const others = Array.from(document.body.children).filter((c) => c !== el && !c.hasAttribute("inert")) as HTMLElement[];
    for (const c of others) c.setAttribute("inert", "");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setHost(el);
    return () => {
      for (const c of others) c.removeAttribute("inert");
      document.body.style.overflow = overflow;
      el.remove();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return host ? createPortal(children, host) : null;
}
