export function gbp(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

// Hand-rolled short dates: Node and browser ICU disagree on en-GB comma
// placement, which breaks React hydration, so no toLocaleDateString here.
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Wed 22 Jul" from an ISO date or datetime. */
export function fmtDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

/**
 * "Wed 22 Jul, 14:00" from an ISO datetime. Slot times are stored as UK
 * wall-clock encoded as UTC, so formatting stays in UTC to round-trip exactly.
 */
export function fmtDayTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}, ${hh}:${mm}`;
}

const LONDON = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * A real moment (a timestamp, not a booked slot) as London wall-clock time in
 * the slot convention, so the slot formatters print it: "2026-10-18T22:04Z"
 * (23:04 BST) → "2026-10-18T23:04:00.000Z". Unparseable input comes back as is.
 */
export function londonWallClock(instant: string): string {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return instant;
  const parts = Object.fromEntries(LONDON.formatToParts(d).map((x) => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00.000Z`;
}

/** The London calendar day of a real moment, yyyy-mm-dd ("2026-10-18T23:30Z" is the 19th in BST). */
export function londonDateOf(instant: string): string {
  return londonWallClock(instant).slice(0, 10);
}

/** "Sun 18 Oct, 23:04" for a real moment, in London time (fmtDayTime is for booked slots). */
export function fmtInstantDayTime(instant: string): string {
  return fmtDayTime(londonWallClock(instant));
}

/** "Sun 18 Oct" for a real moment: the London date, which can differ from the UTC one after midnight. */
export function fmtInstantDay(instant: string): string {
  return fmtDay(londonWallClock(instant));
}

/**
 * "3 Nov 2026" from an ISO date, or from a datetime as London sees it: a
 * moment at 00:30 BST is that day, not the UTC day before. (Booked slots,
 * wall-clock-as-UTC between 08:00 and 18:00, land on the same date either way.)
 */
export function fmtDate(iso: string): string {
  const day = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? londonDateOf(iso) : iso.slice(0, 10);
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "1,234,567" from a whole number, without Intl (runtime-stable). */
function groupThousands(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Money from integer pence: "£1,234", or "£1,234.50" when there are pence.
 * Negative amounts (credits, discounts) read "-£150".
 */
export function money(pence: number): string {
  if (!Number.isFinite(pence)) return "£-";
  const p = Math.round(pence);
  const abs = Math.abs(p);
  const pounds = groupThousands(Math.floor(abs / 100));
  const rest = abs % 100;
  return `${p < 0 ? "-" : ""}£${pounds}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

const POSTCODE_RE =/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export function isValidUkPostcode(value: string): boolean {
  return POSTCODE_RE.test(value.trim());
}

export function normalisePostcode(value: string): string {
  const raw = value.toUpperCase().replace(/\s+/g, "");
  return raw.length > 3 ? `${raw.slice(0, -3)} ${raw.slice(-3)}` : raw;
}

/**
 * A unit of purchase for a quantity: "3 day" → "3 days", "2 pack of 100" →
 * "2 packs of 100". Rates ("per m", "per kg"), symbols ("m", "kg") and units
 * already plural stay as they are.
 */
export function unitWord(unit: string, qty: number): string {
  const u = unit.trim();
  if (!u || qty === 1 || /^per\b/i.test(u) || ["m", "mm", "each", "kg", "g", "ml", "l"].includes(u) || /s$/.test(u)) return u;
  const of = u.match(/^(.*?\S)( of .*)$/);
  if (of) return `${unitWord(of[1]!, qty)}${of[2]}`;
  return `${u}s`;
}
