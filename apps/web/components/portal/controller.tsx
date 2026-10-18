"use client";

import { createContext, useContext } from "react";
import type { HubData, PortalRequest, PortalResult } from "./types";

/**
 * How the hub's buttons reach the world. One component tree, three
 * controllers:
 *  * live: the project's customer; requests go to app/api/portal and the
 *    page re-reads from the server afterwards (so a refresh shows the same);
 *  * demo: /p/demo; the same reducer runs in the browser, nothing persists;
 *  * staff: someone on the team looking at the customer's view; read-only.
 */
export interface HubController {
  mode: "live" | "demo" | "staff";
  /** Do something. Resolves once the change is saved and the view has caught up. */
  request(req: PortalRequest): Promise<PortalResult>;
  /** Start a photo upload for a problem report (live only). */
  uploadPhoto?: (file: File, onProgress?: (fraction: number) => void) => Promise<{ id: string; url: string | null }>;
  /** Where a link goes, or null when this mode shows it in place (the demo). */
  hrefs: {
    proposal: string | null;
    pay: string | null;
    documents: string | null;
    document: (id: string) => string | null;
    ops: string | null;
  };
}

const Ctx = createContext<HubController | null>(null);

export const HubControllerProvider = Ctx.Provider;

export function useHub(): HubController {
  const c = useContext(Ctx);
  if (!c) throw new Error("useHub outside a HubControllerProvider");
  return c;
}

/** Can this viewer press the customer's buttons? */
export function canAct(c: HubController): boolean {
  return c.mode !== "staff";
}

/** Read-only reason, for disabled controls. */
export const STAFF_READ_ONLY = "You're viewing the customer's screen. Make changes from the command centre.";

export type { HubData };
