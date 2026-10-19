import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/site/logo";

/**
 * The customer pages' frame: our mark, a calm header, nothing to get lost
 * in. Server-safe (no hooks), so pages and the demo share it.
 */
export function PortalShell({
  children,
  right,
  width = "wide",
}: {
  children: ReactNode;
  right?: ReactNode;
  width?: "wide" | "narrow";
}) {
  return (
    <div className="min-h-dvh bg-cream">
      <header className="no-print border-b border-line bg-cream/95">
        <div className={`mx-auto flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6 ${width === "wide" ? "max-w-6xl" : "max-w-2xl"}`}>
          <Link href="/" aria-label="Dang, It's Hot home" className="shrink-0">
            <Logo />
          </Link>
          {right && <div className="flex min-w-0 items-center gap-1 text-sm">{right}</div>}
        </div>
      </header>
      <main className={`mx-auto w-full px-4 pb-24 pt-6 sm:px-6 sm:pt-10 ${width === "wide" ? "max-w-6xl" : "max-w-2xl"}`}>{children}</main>
    </div>
  );
}

/** Header links for a signed-in customer: their homes, and sign out. */
export function CustomerNav() {
  return (
    <>
      <Link href="/portal" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-2 font-semibold text-ink-700 hover:bg-surface hover:text-ink-900 sm:px-3">
        Your homes
      </Link>
      <form action="/auth/logout" method="post">
        <input type="hidden" name="next" value="/portal?signedOut=1" />
        <button type="submit" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-2 font-semibold text-ink-700 hover:bg-surface hover:text-ink-900 sm:px-3">
          Sign out
        </button>
      </form>
    </>
  );
}

/** Header link for the team: back to the command centre. */
export function StaffNav({ href, label = "Ops view" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center rounded-full border border-line bg-white px-4 font-semibold text-ink-900 hover:border-ink-300">
      {label}
    </Link>
  );
}
