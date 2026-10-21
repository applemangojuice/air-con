"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A nav link that knows when it's the current section (aria-current), for
 * the app shells. Matches the exact path, or any path below it unless
 * `exact` (so "/ops/projects" stays lit on "/ops/projects/123").
 */
export function NavLink({
  href,
  exact = false,
  className = "",
  activeClassName = "",
  inactiveClassName = "",
  children,
}: {
  href: string;
  exact?: boolean;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`${className} ${active ? activeClassName : inactiveClassName}`.trim()}>
      {children}
    </Link>
  );
}
