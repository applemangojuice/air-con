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

const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function londonParts(ms: number): { y: number; mo: number; d: number; h: number; mi: number } {
  const get = (parts: Intl.DateTimeFormatPart[], t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const parts = LONDON.formatToParts(new Date(ms));
  return { y: get(parts, "year"), mo: get(parts, "month"), d: get(parts, "day"), h: get(parts, "hour") % 24, mi: get(parts, "minute") };
}

/**
 * "2026-10-18T14:30" as typed on a London clock → the real instant (ISO, UTC).
 * Handles BST and GMT. Null when it isn't a date and time.
 */
export function londonLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  if (!Number.isFinite(asUtc)) return null;
  const seen = londonParts(asUtc);
  const offset = Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi) - asUtc;
  return new Date(asUtc - offset).toISOString();
}

/** A real instant on the London clock, for a datetime-local field: "2026-10-18T14:30". */
export function isoToLondonLocal(iso: string): string {
  const p = londonParts(Date.parse(iso));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${two(p.mo)}-${two(p.d)}T${two(p.h)}:${two(p.mi)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A real instant as London sees it: "18 Oct 2026, 14:30". Server-rendered only. */
export function fmtLondon(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const p = londonParts(ms);
  return `${p.d} ${MONTHS[p.mo - 1]} ${p.y}, ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

/** A text field, trimmed, or undefined when blank. */
export function text(form: FormData, name: string, max = 2000): string | undefined {
  const v = String(form.get(name) ?? "").trim();
  return v ? v.slice(0, max) : undefined;
}
