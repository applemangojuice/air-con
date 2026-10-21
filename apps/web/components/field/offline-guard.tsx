"use client";

import { useEffect, useState } from "react";

/**
 * Field pages are rendered on the server, so following a link with no
 * signal lands on the browser's own "No internet" page, and Back can't get
 * the crew back to the runsheet until signal returns. While the phone says
 * it's offline, this stops links inside the app from leaving the screen
 * they're on, and says why: what they've captured is safe on the phone, and
 * the screen in front of them still works.
 *
 * It listens in the capture phase on window, ahead of Next's own link
 * handling, and only for plain same-origin navigations (not new tabs,
 * downloads, phone or map links, or a jump within the page).
 */
export function OfflineGuard() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (navigator.onLine !== false) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // tel:, maps and the like
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return; // same page
      e.preventDefault();
      e.stopPropagation();
      setBlocked(true);
    };
    const online = () => setBlocked(false);
    window.addEventListener("click", onClick, true);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("online", online);
    };
  }, []);

  if (!blocked) return null;
  return (
    <div role="alert" className="fixed inset-x-0 bottom-20 z-50 px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-xl items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-base text-amber-950 shadow-lg">
        <p className="min-w-0 flex-1">
          <strong>You&apos;re offline.</strong> That screen needs signal to open. You&apos;re still on this one, and everything you&apos;ve captured is saved on the phone.
        </p>
        <button type="button" onClick={() => setBlocked(false)} className="-my-1 min-h-11 shrink-0 rounded-full px-3 font-semibold text-amber-950 underline underline-offset-2">
          OK
        </button>
      </div>
    </div>
  );
}
