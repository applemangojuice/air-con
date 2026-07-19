import { BRAND } from "./brand";

/**
 * The one place email leaves the platform from. Resend under the hood,
 * best-effort by design: email must never take a request down with it.
 * Unconfigured (no RESEND_API_KEY/EMAIL_FROM) → quiet no-op, callers treat
 * `false` as "not sent".
 */

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
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
