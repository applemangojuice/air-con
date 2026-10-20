import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { OfflineGuard } from "@/components/field/offline-guard";
import { OutboxKick } from "@/components/field/outbox-kick";
import { CatchUpRunner } from "@/components/field/server-answer";
import { ModeBanner } from "@/components/kit/mode-banner";
import { NavLink } from "@/components/kit/nav-link";
import { Mark } from "@/components/site/logo";

/**
 * The field shell (contract §F): the surveyor's and installer's phone app.
 * Large type, high contrast, 48 px targets, no marketing chrome. A sticky
 * header with two slots pages fill through portals:
 *
 *  * #field-header-title: the job title (falls back to "Field" while empty);
 *  * #field-sync-badge: the offline outbox's "3 unsynced" badge (F6).
 *
 * Bottom tabs: Today, Jobs, Issues, Me. The wall is middleware; pages call
 * requireStaff themselves. With no signal, OfflineGuard keeps links from
 * dropping the crew onto the browser's "No internet" page (there's no
 * service worker: plan §3 leaves full offline out, the outbox covers
 * capture).
 */

export const metadata: Metadata = {
  title: { default: "Field", template: "%s · Field" },
  robots: { index: false, follow: false },
  // Added to the Home Screen from here, the icon opens the field app (app/field.webmanifest).
  manifest: "/field.webmanifest",
  appleWebApp: { capable: true, title: "Field", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

const TABS: { href: string; label: string; exact?: boolean; icon: ReactNode }[] = [
  {
    href: "/field",
    label: "Today",
    exact: true,
    icon: (
      <path d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.4-6.4-1.4 1.4M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
    ),
  },
  { href: "/field/jobs", label: "Jobs", icon: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /> },
  {
    href: "/field/issues",
    label: "Issues",
    icon: <path d="M12 9v4m0 4h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  },
  {
    href: "/field/me",
    label: "Me",
    icon: <path d="M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z" />,
  },
];

export default function FieldLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-cream text-lg text-ink-900">
      <ModeBanner />
      <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-xl items-center gap-3 px-4">
          <Link href="/field" aria-label="Field: today" className="flex min-h-12 min-w-12 items-center">
            <Mark size={30} />
          </Link>
          <div className="min-w-0 flex-1 font-semibold">
            <span id="field-header-title" className="peer block truncate empty:hidden" />
            <span className="hidden truncate peer-empty:block">Field</span>
          </div>
          <span id="field-sync-badge" aria-live="polite" className="shrink-0 empty:hidden" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-28 pt-5">{children}</main>
      <OfflineGuard />
      <OutboxKick />
      <CatchUpRunner />

      <nav aria-label="Field" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-xl grid-cols-4">
          {TABS.map((t) => (
            <li key={t.href}>
              <NavLink
                href={t.href}
                exact={t.exact}
                className="flex min-h-16 flex-col items-center justify-center gap-1 text-sm font-semibold"
                activeClassName="text-accent-700"
                inactiveClassName="text-ink-700 hover:text-ink-900"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  {t.icon}
                </svg>
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
