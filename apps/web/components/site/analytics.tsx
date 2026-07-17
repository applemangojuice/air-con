"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics-client";

/**
 * Mounted once in the root layout. Records a `page_view` on first load and on
 * every client-side route change, so we can see who's on the site, which
 * pages they hit and where they came from. Cookieless and fire-and-forget:
 * see lib/analytics-client.ts.
 */
export function Analytics() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;
    track("page_view");
  }, [pathname]);

  return null;
}
