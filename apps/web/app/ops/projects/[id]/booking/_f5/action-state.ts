import type { Blocker } from "@aircon/domain";

/**
 * What every F5 server action answers with, for ActionForm to show. Plain
 * data (it crosses the server/client boundary).
 */
export interface ActionState {
  ok?: boolean;
  message?: string;
  warning?: string;
  error?: string;
  blockers?: Blocker[];
}

type OutcomeLike =
  | { ok: true; message?: string; warning?: string }
  | { ok: false; error: string; blockers?: Blocker[] };

/** A server module's Outcome as an ActionState, with a default success message. */
export function toState(outcome: OutcomeLike, success = "Saved."): ActionState {
  if (!outcome.ok) return { error: outcome.error, ...(outcome.blockers?.length ? { blockers: outcome.blockers } : {}) };
  return { ok: true, message: outcome.message ?? success, ...(outcome.warning ? { warning: outcome.warning } : {}) };
}

/** A zod (or any) validation failure, in the house words. */
export function invalid(message = "Some of that didn't look right. Check the form and try again."): ActionState {
  return { error: message };
}

/** "£1,234.50" / "1234.5" / "1,234" → pence, or null when it isn't money. */
export function poundsToPence(input: FormDataEntryValue | null | undefined): number | null {
  const raw = String(input ?? "").replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** A text field, trimmed, or undefined when blank. */
export function text(form: FormData, name: string, max = 2000): string | undefined {
  const v = String(form.get(name) ?? "").trim();
  return v ? v.slice(0, max) : undefined;
}
