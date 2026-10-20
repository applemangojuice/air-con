import type { HubData } from "./types";

/**
 * The hub as the family's own answers left it, before the page's data has
 * caught up: a change they've just said yes or no to leaves "A change needs
 * your answer" at once (as the server moved it: yes is work to do, no is
 * settled), whether or not the refresh after it ever lands (Next 15.5's
 * in-place refresh can stall: components/field/server-answer.ts). Only
 * while the page still shows it waiting; the page's own data wins after.
 * Pure, so it's tested (tests/portal.test.ts).
 */
export type Decided = Record<string, { status: "accepted" | "declined"; at: string }>;

export function withDecisions(data: HubData, decided: Decided): HubData {
  if (!Object.keys(decided).length) return data;
  let changed = false;
  const issues = data.issues.map((i) => {
    const d = decided[i.id];
    if (!d || !i.variation || i.variation.status !== "proposed") return i;
    changed = true;
    return { ...i, status: d.status === "accepted" ? ("in-progress" as const) : ("resolved" as const), variation: { ...i.variation, status: d.status, decidedAt: d.at } };
  });
  return changed ? { ...data, issues } : data;
}
