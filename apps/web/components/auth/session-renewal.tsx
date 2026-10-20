"use client";

import { useEffect } from "react";

/**
 * Keeps a staff sign-in going while it's used (§K45). The shell passes when
 * this session can next be renewed (`renewableFrom`, seconds); once that's
 * passed, the first page opened asks `/auth/renew` to re-sign the cookie
 * (the server re-checks the person and the 90-day cap). Without signal it
 * tries again on the next page. Renders nothing.
 */

let asked = 0;

export function SessionRenewal({ from }: { from: number | null }) {
  useEffect(() => {
    if (from === null || Date.now() / 1000 < from || asked === from) return;
    asked = from;
    void fetch("/auth/renew", { method: "POST", credentials: "same-origin", cache: "no-store" }).catch(() => {
      asked = 0; // no signal: try again on the next page
    });
  }, [from]);
  return null;
}
