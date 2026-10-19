import { BRAND } from "./brand";
import { realEnv } from "./env-placeholders";

/**
 * The one place email leaves the platform from. Resend under the hood,
 * best-effort by design: email must never take a request down with it.
 * Unconfigured (no RESEND_API_KEY/EMAIL_FROM) → quiet no-op, callers treat
 * `false` as "not sent".
 */

export function emailConfigured(): boolean {
  // A template key (re_xxx) isn't a provider: stay honestly in demo mode.
  return Boolean(realEnv(process.env, "RESEND_API_KEY") && process.env.EMAIL_FROM);
}

/** Where team-facing alerts go: LEADS_NOTIFY_EMAIL, else the from-address. */
export function teamInbox(): string | null {
  if (process.env.LEADS_NOTIFY_EMAIL) return process.env.LEADS_NOTIFY_EMAIL;
  const from = process.env.EMAIL_FROM;
  if (!from) return null;
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) console.error("email send failed:", res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error("email send failed:", err);
    return false;
  }
}

/** Team alert: no-op (false) when the inbox isn't configured. */
export async function sendTeamEmail(subject: string, html: string): Promise<boolean> {
  const to = teamInbox();
  if (!to) return false;
  return sendEmail(to, subject, html);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Deliverability-safe branded shell: one table, inline styles, no images.
 * `bodyHtml` is trusted markup built by the caller (escape user input with
 * escapeHtml before interpolating).
 */
export function brandedEmail(bodyHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d212b">
  <tr><td style="padding:28px 24px 20px">
    <span style="font-size:20px;font-weight:700">${escapeHtml(BRAND.nameLead)} <span style="color:#f2711b">${escapeHtml(BRAND.nameHot)}</span></span>
  </td></tr>
  <tr><td style="padding:0 24px">
    ${bodyHtml}
    <p style="margin:0 0 28px;color:#a3a8b4;font-size:12px;border-top:1px solid #ddd5c4;padding-top:16px">${escapeHtml(BRAND.name)} · ${escapeHtml(BRAND.tagline)}</p>
  </td></tr>
</table>`;
}

/* ------------------------------------------------------------------ */
/* The quote email (operational: no marketing in it)                    */
/* ------------------------------------------------------------------ */

export interface QuoteEmailInput {
  name: string;
  /** The permanent /q/[id] link. */
  link: string;
  totalGbp: number;
  roomCount: number;
  /** yyyy-mm-dd: the last day the price is valid (settings.pricing.quoteValidityDays). */
  validUntil: string;
  /** "up to three days" (settings.scheduling.installBlockDays). */
  installDays: string;
  /** VAT in plain words from settings, or null to say nothing. */
  vatLine: string | null;
  /** "Free" or "£150" (settings.scheduling.surveyFeeGbp). */
  surveyPrice: string;
  /** "about 90 minutes", or null. */
  surveyDuration: string | null;
  supportEmail: string;
  /** A real phone number, or null (never the placeholder). */
  supportPhone: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const pounds = (gbp: number) => `£${String(Math.round(gbp)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

/**
 * The customer's copy of their price. Calm and plain: the price is confirmed
 * at the home survey (never "fixed", "guaranteed" or "doesn't expire"), it's
 * valid until a stated date, and the one next step is booking the survey.
 * Every value from the customer is escaped.
 */
export function quoteEmail(input: QuoteEmailInput): { subject: string; html: string } {
  const total = pounds(input.totalGbp);
  const rooms = `${input.roomCount} room${input.roomCount === 1 ? "" : "s"}`;
  const survey = [input.surveyPrice.toLowerCase() === "free" ? "free" : input.surveyPrice, input.surveyDuration]
    .filter(Boolean)
    .join(", ");
  const link = escapeHtml(input.link);
  const contact = input.supportPhone
    ? `reply to this email or call ${escapeHtml(input.supportPhone)}`
    : `reply to this email or write to ${escapeHtml(input.supportEmail)}`;
  const html = brandedEmail(`<p style="margin:0 0 14px">Hi ${escapeHtml(input.name)},</p>
    <p style="margin:0 0 6px;color:#5d6371;font-size:14px">Your price for heating and cooling ${rooms}:</p>
    <p style="margin:0 0 6px;font-size:36px;font-weight:700">${total}</p>
    <p style="margin:0 0 16px;color:#454b58;font-size:14px">Installed over ${escapeHtml(input.installDays)}${input.vatLine ? ` · ${escapeHtml(input.vatLine)}` : ""} · valid until ${longDate(input.validUntil)}</p>
    <p style="margin:0 0 20px;color:#454b58">We confirm this price at your home survey. It only changes if the survey finds something your answers didn't show, and if it does, your proposal will say exactly what changed and why before you agree to anything.</p>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#a84508;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:999px">View my quote</a>
    </p>
    <p style="margin:0 0 6px;font-size:13px;color:#5d6371">Or copy this link:</p>
    <p style="margin:0 0 24px;font-size:13px"><a href="${link}" style="color:#a84508">${link}</a></p>
    <p style="margin:0 0 8px;color:#454b58"><strong>Next step:</strong> book your home survey from that page${survey ? ` (${escapeHtml(survey)})` : ""}, at a time that suits you. There's no obligation.</p>
    <p style="margin:0 0 28px;color:#454b58">Questions? Just ${contact}.</p>
    <p style="margin:0 0 20px;color:#5d6371;font-size:12px">You're getting this because you asked for a price on our website. We only email you about this quote unless you asked for news and offers.</p>`);
  return { subject: `Your price: ${total} for ${rooms}`, html };
}
