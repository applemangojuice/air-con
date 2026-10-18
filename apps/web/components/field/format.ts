import { ROLE_LABEL, type StaffRole } from "@aircon/domain";
import { fmtDate, fmtDay, fmtDayTime, money } from "@/lib/format";

/**
 * Field formatting on top of lib/format.ts. Real instants (when a day
 * started, when a photo was taken) are shown in London time; appointment
 * slots stay UK wall-clock as stored (fmtDayTime). Intl with a fixed zone
 * and fixed parts gives the same string on server and phone, so hydration
 * matches.
 */

export { fmtDate, fmtDay, fmtDayTime, money };

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parts(iso: string): Record<string, string> | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Object.fromEntries(PARTS.formatToParts(d).map((p) => [p.type, p.value]));
}

/** "08:31" in London, from an ISO instant. */
export function londonTime(iso: string | undefined): string {
  const p = iso ? parts(iso) : null;
  return p ? `${p.hour}:${p.minute}` : "";
}

/** "2026-11-10", the London date of an instant. */
export function londonDateOf(iso: string): string {
  const p = parts(iso);
  return p ? `${p.year}-${p.month}-${p.day}` : iso.slice(0, 10);
}

/** "Today 08:31", "Tue 10 Nov 08:31". */
export function whenLabel(iso: string | undefined, today: string): string {
  if (!iso) return "";
  const date = londonDateOf(iso);
  return `${date === today ? "Today" : fmtDay(date)} ${londonTime(iso)}`;
}

/** Slot time ("10:00") from a UK wall-clock-as-UTC appointment. */
export function slotTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "07700 900103" → "tel:+447700900103". */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits.startsWith("0") ? `+44${digits.slice(1)}` : digits}`;
}

/** "DEMO Tess (technical lead)" on the crew as a technical lead → "DEMO Tess, technical lead". */
export function crewLabel(c: { name: string; role: StaffRole }): string {
  return `${c.name.replace(/\s*\([^)]*\)\s*$/, "")}, ${ROLE_LABEL[c.role].toLowerCase()}`;
}

/** "DEMO Tess (technical lead)" → "Tess": a person's name as a sentence uses it. */
export function personName(name: string): string {
  return name.replace(/^DEMO\s+/, "").replace(/\s*\([^)]*\)\s*$/, "").trim() || name;
}

/** First name for greetings, skipping the DEMO label. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/).filter((w) => w !== "DEMO")[0] || "there";
}
