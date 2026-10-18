import type { Blocker } from "@aircon/domain";

/**
 * What every ops server action answers: done (with a line to say so), or
 * refused with the reason and, for a gate, exactly the blockers. Plain JSON,
 * so it crosses the server/client boundary as is.
 */
export interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
  blockers?: Blocker[];
  /** A link the success message offers (e.g. the project just created). */
  href?: string;
  /** Extra data a form may show (e.g. an on-screen sign-in link in development). */
  detail?: string;
}

export const done = (message: string, extra: Partial<ActionResult> = {}): ActionResult => ({ ok: true, message, ...extra });
export const refused = (error: string, blockers?: Blocker[]): ActionResult => ({ ok: false, error, ...(blockers?.length ? { blockers } : {}) });
