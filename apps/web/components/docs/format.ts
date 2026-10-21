/**
 * Formatting for printed documents (server-rendered only, so Intl's time
 * zone support is safe here: no hydration to drift).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Nov 2026, 20:15" in London time, for real instants (acceptances, payments, sign-offs). */
export function fmtInstant(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${Number(get("day"))} ${MONTHS[Number(get("month")) - 1]} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** "solid-brick" → "Solid brick". */
export function plain(value: string | undefined | null): string {
  if (!value) return "";
  const s = value.replace(/[-_]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : "";
}

/** 3.456 → "3.46"; whole numbers stay whole. */
export function num(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "–";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/\.?0+$/, "");
}
