"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { SurveySectionId } from "@aircon/domain";

/**
 * Where the surveyor is in the survey, in the URL (?s=rooms&r=<roomId>), so
 * the phone's back gesture steps back through the survey (room → rooms →
 * overview) and a refresh opens the same screen. Uses the history API,
 * which Next keeps in step with useSearchParams without a server round trip.
 */

export type ScreenId = "overview" | SurveySectionId | "assumptions" | "consent" | "submit";

export interface Nav {
  s: ScreenId;
  r?: string;
  o?: string;
  /** A field to scroll to and focus once the screen is showing. */
  f?: string;
}

const SCREENS: ScreenId[] = ["overview", "site", "wishes", "house", "rooms", "outdoor", "electrics", "permissions", "risks", "assumptions", "consent", "submit"];

export const SCREEN_LABEL: Record<ScreenId, string> = {
  overview: "Survey",
  site: "Site & people",
  wishes: "Wishes",
  house: "House",
  rooms: "Rooms",
  outdoor: "Outdoor",
  electrics: "Electrics",
  permissions: "Permissions",
  risks: "Risks",
  assumptions: "Assumptions & unknowns",
  consent: "Documents by email",
  submit: "Check and submit",
};

/** The order "Next" walks through. */
export const FLOW: ScreenId[] = ["site", "wishes", "house", "rooms", "outdoor", "electrics", "permissions", "risks", "assumptions", "consent", "submit"];

export function nextScreen(s: ScreenId): ScreenId | null {
  const i = FLOW.indexOf(s);
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1]! : null;
}

function parse(params: URLSearchParams | null): Nav {
  const s = params?.get("s") as ScreenId | null;
  const r = params?.get("r") ?? undefined;
  const o = params?.get("o") ?? undefined;
  return { s: s && SCREENS.includes(s) ? s : "overview", ...(r ? { r } : {}), ...(o ? { o } : {}) };
}

function toQuery(nav: Nav): string {
  const q = new URLSearchParams();
  if (nav.s !== "overview") q.set("s", nav.s);
  if (nav.r) q.set("r", nav.r);
  if (nav.o) q.set("o", nav.o);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function useSurveyNav(storageKey: string) {
  const params = useSearchParams();
  const nav = useMemo(() => parse(params), [params]);
  const pendingField = useRef<string | null>(null);

  const go = useCallback(
    (next: Nav, opts: { replace?: boolean } = {}) => {
      pendingField.current = next.f ?? null;
      const url = `${window.location.pathname}${toQuery(next)}`;
      if (opts.replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
      try {
        window.localStorage.setItem(storageKey, toQuery(next));
      } catch {
        // resume-where-you-left-off is a nicety
      }
    },
    [storageKey],
  );

  // A fresh visit with no screen in the URL resumes where this phone left off.
  useEffect(() => {
    if (window.location.search) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) window.history.replaceState(null, "", `${window.location.pathname}${saved}`);
    } catch {
      // ignore
    }
  }, [storageKey]);

  // New screen: to the top, or to the field a jump link asked for.
  useEffect(() => {
    const field = pendingField.current;
    pendingField.current = null;
    if (!field) {
      window.scrollTo({ top: 0 });
      return;
    }
    const t = window.setTimeout(() => {
      const el = document.getElementById(`f-${field}`);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const focusable = el.matches("input, textarea, select, button, [tabindex]") ? el : el.querySelector<HTMLElement>("input, textarea, select, button");
      (focusable as HTMLElement | null)?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(t);
  }, [nav.s, nav.r, nav.o]);

  return { nav, go };
}

/** "09:38" in London, from a real instant (not the wall-clock-as-UTC appointment convention). */
export function londonClock(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")}`;
}
