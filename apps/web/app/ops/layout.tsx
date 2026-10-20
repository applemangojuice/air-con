import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ModeBanner } from "@/components/kit/mode-banner";
import { Menu } from "@/components/kit/menu";
import { NavLink } from "@/components/kit/nav-link";
import { Mark } from "@/components/site/logo";
import { SessionRenewal } from "@/components/auth/session-renewal";
import { getSession } from "@/lib/auth/server";
import { renewableFrom } from "@/lib/auth/session";

/**
 * The ops shell (contract §F): mode banner, the team's top nav and who's
 * signed in, around every /ops page. The wall is middleware; each page
 * still calls requireStaff for its own permission. Pages that predate the
 * shell render their own site header below it; the shell isn't sticky so
 * theirs still is. Hidden in print, so collateral pages print clean.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const PRIMARY = [
  { href: "/ops/projects", label: "Board" },
  { href: "/ops/calendar", label: "Calendar" },
  { href: "/ops/purchasing", label: "Purchasing" },
  { href: "/ops/catalogue", label: "Catalogue" },
  { href: "/ops/pilots", label: "Pilots" },
  { href: "/ops/messages", label: "Messages" },
  { href: "/ops/staff", label: "Staff" },
  { href: "/ops/settings", label: "Settings" },
];

const MORE = [
  { href: "/ops", label: "Console", exact: true },
  { href: "/ops/quotes", label: "Quotes" },
  { href: "/ops/intel", label: "Intel" },
  { href: "/ops/analytics", label: "Analytics" },
  { href: "/ops/finance", label: "Finance" },
  { href: "/ops/status", label: "Status" },
  { href: "/ops/help", label: "Help: daily routine" },
];

const NAV_ITEM = "inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-3 text-sm font-semibold transition";

export default async function OpsLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const staff = session?.kind === "staff" ? session : null;

  return (
    <>
      <SessionRenewal from={staff ? renewableFrom(staff) : null} />
      <div className="no-print">
        <ModeBanner />
        <header className="bg-ink-950 text-white">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-3 sm:px-6">
            <Link href="/ops/projects" className="flex items-center gap-2 rounded-full" aria-label="Ops home: the board">
              <Mark size={28} dark />
              <span className="font-display text-lg leading-none">Ops</span>
            </Link>
            <div className="ml-auto flex min-w-0 items-center gap-2 text-sm">
              {staff ? (
                <>
                  <span className="hidden truncate text-white/80 sm:inline" title={staff.email}>
                    {staff.name || staff.email}
                  </span>
                  <form action="/auth/logout" method="post">
                    <button
                      type="submit"
                      className="inline-flex min-h-10 items-center rounded-full border border-white/25 px-3 font-semibold text-white hover:bg-white/10"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <Link href="/login?next=/ops/projects" className="inline-flex min-h-10 items-center rounded-full px-3 font-semibold hover:bg-white/10">
                  Sign in
                </Link>
              )}
            </div>
          </div>
          <div className="mx-auto flex max-w-6xl items-center gap-1 px-2 pb-2 pt-2 sm:px-4">
            <nav aria-label="Ops" className="min-w-0 flex-1 overflow-x-auto">
              <ul className="flex min-w-max items-center gap-1">
                {PRIMARY.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      href={item.href}
                      className={NAV_ITEM}
                      activeClassName="bg-white/15 text-white"
                      inactiveClassName="text-white/75 hover:bg-white/10 hover:text-white"
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <Menu
              className="shrink-0"
              summary={
                <>
                  More
                  <span aria-hidden className="ml-1">
                    ▾
                  </span>
                </>
              }
              summaryClassName={`${NAV_ITEM} text-white/75 hover:bg-white/10 hover:text-white`}
              panelClassName="w-48 overflow-hidden rounded-2xl border border-line bg-white py-1 text-ink-900 shadow-lg"
            >
              <ul>
                {MORE.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      href={item.href}
                      exact={item.exact}
                      className="flex min-h-11 items-center px-4 text-sm font-medium"
                      activeClassName="bg-accent-50 text-accent-700"
                      inactiveClassName="hover:bg-surface"
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </Menu>
          </div>
        </header>
      </div>
      {children}
    </>
  );
}
