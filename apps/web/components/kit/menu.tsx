"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A no-JS-first dropdown on <details>: works before hydration, then closes
 * itself on navigation, on Escape and on a click outside, which <details>
 * alone doesn't do.
 */
export function Menu({
  summary,
  summaryClassName = "",
  panelClassName = "",
  className = "",
  children,
}: {
  summary: ReactNode;
  summaryClassName?: string;
  panelClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className={`relative ${className}`.trim()}>
      <summary className={`cursor-pointer list-none [&::-webkit-details-marker]:hidden ${summaryClassName}`.trim()}>{summary}</summary>
      <div className={`absolute right-0 top-full z-50 mt-1 ${panelClassName}`.trim()}>{children}</div>
    </details>
  );
}
