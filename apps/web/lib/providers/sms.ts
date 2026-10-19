/**
 * SMS out through Twilio's REST API (plain fetch, no SDK), contract §F.
 *
 * Configured with TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM.
 * TWILIO_FROM is an alphanumeric sender ("DangItsHot", up to 11 characters),
 * a number in E.164, or a Messaging Service SID (MG…). The alphanumeric
 * sender is one-way, which is why every template carries our phone number.
 * Unconfigured → callers record the message as demo, never as sent.
 *
 * Pure helpers (number normalisation, GSM-7 segment maths) live here too and
 * import nothing, so `node --test` can load this file directly.
 */

import { realEnv } from "../env-placeholders.ts";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export function smsConfigured(): boolean {
  // Template values (ACxxxx…, your-twilio-auth-token) aren't a provider: stay honestly in demo mode.
  const env = process.env;
  return Boolean(realEnv(env, "TWILIO_ACCOUNT_SID") && realEnv(env, "TWILIO_AUTH_TOKEN") && env.TWILIO_FROM);
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/**
 * A phone number as typed by a person → E.164, or null when it can't be one.
 * UK forms: "07700 900123", "+44 (0)7700 900123", "0044 7700 900123",
 * "447700900123" → "+447700900123". A number already in international form
 * for another country passes through when it's plausibly E.164.
 */
export function normaliseUkPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\(0\)/g, "");
  s = s.replace(/[\s\-.() ]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!/^\+?\d+$/.test(s)) return null;

  let national: string | null = null;
  if (s.startsWith("+44")) national = s.slice(3).replace(/^0/, "");
  else if (s.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
  else if (s.startsWith("44") && s.length >= 11) national = s.slice(2).replace(/^0/, "");
  else if (s.startsWith("0")) national = s.slice(1);
  if (national === null) return null;

  // UK national significant numbers are 9 or 10 digits and never start with 0.
  return /^[1-9]\d{8,9}$/.test(national) ? `+44${national}` : null;
}

/** UK mobiles (07…): the only UK numbers that can take a text. */
export function isUkMobile(e164: string): boolean {
  return /^\+447\d{9}$/.test(e164);
}

/** Can we text this E.164 number? UK landlines can't; other countries we don't second-guess. */
export function isTextable(e164: string): boolean {
  return e164.startsWith("+44") ? isUkMobile(e164) : /^\+[1-9]\d{7,14}$/.test(e164);
}

/* ------------------------------------------------------------------ */
/* Text: GSM-7 and segments                                            */
/* ------------------------------------------------------------------ */

// The GSM 03.38 basic set (each one septet) and the extension table (two).
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENDED = new Set("^{}\\[~]|€\f");

const isGsmChar = (ch: string) => GSM_BASIC.has(ch) || GSM_EXTENDED.has(ch);

const TYPOGRAPHIC: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "′": "'",
  "“": '"', "”": '"', "„": '"', "″": '"',
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
  "…": "...", " ": " ", "•": "-", "·": "-",
};

/**
 * Keep a message in GSM-7 where we can: one stray curly apostrophe or an
 * accented name would otherwise switch the whole text to UCS-2 and cut each
 * segment from 160 characters to 70. Typographic punctuation becomes ASCII,
 * accents are dropped where the bare letter is GSM ("Zoë" → "Zoe"), and
 * anything else (other scripts, emoji) is kept as written: a longer message
 * beats a mangled name.
 */
export function gsmSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    if (isGsmChar(ch)) {
      out += ch;
      continue;
    }
    const typo = TYPOGRAPHIC[ch];
    if (typo !== undefined) {
      out += typo;
      continue;
    }
    const bare = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += bare && [...bare].every(isGsmChar) ? bare : ch;
  }
  return out;
}

export interface SmsLength {
  encoding: "gsm7" | "ucs2";
  /** Septets for GSM-7 (extension characters count two), UTF-16 units for UCS-2. */
  units: number;
  segments: number;
}

/** How many billable segments a text takes: 160/153 per segment in GSM-7, 70/67 in UCS-2. */
export function smsLength(text: string): SmsLength {
  const chars = [...text];
  if (chars.every(isGsmChar)) {
    const units = chars.reduce((n, ch) => n + (GSM_EXTENDED.has(ch) ? 2 : 1), 0);
    return { encoding: "gsm7", units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  const units = text.length;
  return { encoding: "ucs2", units, segments: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67) };
}

/** Our templates' budget: two segments, so a text never arrives in pieces out of order on old phones. */
export const SMS_MAX_SEGMENTS = 2;

/**
 * The first candidate that fits the budget once made GSM-safe, else the
 * shortest one. Templates pass a full version, then shorter fallbacks
 * (dropping the address or the name) for long names and addresses.
 */
export function fitSms(candidates: string[], maxSegments = SMS_MAX_SEGMENTS): string {
  const safe = candidates.map((c) => gsmSafe(c.replace(/\s+/g, " ").trim())).filter(Boolean);
  if (safe.length === 0) return "";
  const fits = safe.find((c) => smsLength(c).segments <= maxSegments);
  if (fits) return fits;
  return safe.reduce((a, b) => (smsLength(b).units < smsLength(a).units ? b : a));
}

/* ------------------------------------------------------------------ */
/* Send                                                                */
/* ------------------------------------------------------------------ */

export interface SmsResult {
  ok: boolean;
  /** Twilio's message SID: the provider acknowledgement that makes it "sent". */
  providerRef?: string;
  error?: string;
}

/** Alphanumeric sender rules (UK): 1–11 letters, digits or spaces, at least one letter. */
function senderParam(from: string): [string, string] | null {
  if (/^MG[0-9a-f]{32}$/i.test(from)) return ["MessagingServiceSid", from];
  if (/^\+[1-9]\d{7,14}$/.test(from)) return ["From", from];
  if (/^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/.test(from)) return ["From", from];
  return null;
}

/**
 * Send one text. Never throws: every failure comes back as `{ ok: false,
 * error }` so a provider outage can't take a request down. Returns
 * `not configured` when the env vars are missing; callers check
 * `smsConfigured()` first and record demo instead.
 */
export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM?.trim();
  if (!sid || !token || !from) return { ok: false, error: "SMS not configured" };

  const number = normaliseUkPhone(to);
  if (!number) return { ok: false, error: "Not a valid phone number" };
  if (!isTextable(number)) return { ok: false, error: "Not a mobile number" };
  const sender = senderParam(from);
  if (!sender) return { ok: false, error: "TWILIO_FROM must be an E.164 number, a Messaging Service SID or an alphanumeric sender of up to 11 characters" };
  const text = gsmSafe(body).trim();
  if (!text) return { ok: false, error: "Empty message" };

  const form = new URLSearchParams({ To: number, Body: text });
  form.set(sender[0], sender[1]);
  try {
    const res = await fetch(`${TWILIO_API}/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { sid?: string; message?: string; code?: number } | null;
    if (!res.ok || !json?.sid) {
      const detail = json?.message ? `${json.message}${json.code ? ` (${json.code})` : ""}` : `HTTP ${res.status}`;
      return { ok: false, error: `Twilio: ${detail}` };
    }
    return { ok: true, providerRef: json.sid };
  } catch (err) {
    return { ok: false, error: `Twilio unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
