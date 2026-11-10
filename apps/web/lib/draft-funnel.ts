import { z } from "zod";
import { funnelState, reminderRecord } from "./follow-up";

/**
 * What an unfinished quote keeps besides its survey (api/quotes/draft and
 * draft/[id]): the reminder answer and the funnel's own state, in the
 * attribution JSON (no migration needed). Shared by both routes; route
 * files may export only their handlers.
 */

/** The funnel's own state, kept with the draft so a resume link restores it exactly. */
export const funnelFields = {
  layout: z.enum(["open-plan", "separate", "two-receptions", "other"]).optional(),
  prefillSource: z.enum(["records", "neighbours"]).optional(),
};

/**
 * A draft's attribution after a save: the reminder answer (when this save
 * carries one; otherwise the one on record stands) and the funnel state,
 * stamped with now as its last activity.
 */
export function draftAttribution(
  input: { reminder?: boolean; reminderNotice?: string; layout?: string; prefillSource?: string },
  previous: unknown,
  at: string,
): Record<string, unknown> {
  const prev = typeof previous === "object" && previous !== null ? (previous as Record<string, unknown>) : {};
  const reminder = reminderRecord(input, at);
  const funnel = funnelState(prev);
  return {
    ...prev,
    ...(reminder ? { reminder } : {}),
    funnel: {
      ...funnel,
      ...(input.layout ? { layout: input.layout } : {}),
      ...(input.prefillSource ? { prefillSource: input.prefillSource } : {}),
      lastActiveAt: at,
    },
  };
}
