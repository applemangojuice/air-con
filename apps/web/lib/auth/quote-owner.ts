import { base64urlDecode, base64urlEncode, constantTimeEqual, hmacSha256Hex, sessionSecret } from "./session.ts";

/**
 * "This browser saved that quote": a signed, httpOnly cookie listing the
 * quotes saved from this browser in the last few days, so the funnel's "Book
 * my home survey" opens the new project straight away instead of stopping at
 * "check your email".
 *
 *   dih_quote = base64url(JSON { q: quoteIds, exp }) + "." + hex(HMAC-SHA256(secret, "quote-owner." + payload))
 *
 * It is deliberately narrower than a customer session. The email typed into
 * the funnel was never verified, so the cookie must not sign anyone in as the
 * customer record behind that address (whose other projects, now or later,
 * would come with it). It only opens the project created from one of these
 * quotes (lib/auth/access.ts decideProjectAccess), which holds nothing the
 * browser didn't type itself. A verified customer session (magic link)
 * replaces it as soon as they use one of our emails. The purpose prefix in the
 * MAC means a session cookie can't be replayed as one of these, or the reverse.
 *
 * Edge-safe and self-contained, like session.ts.
 */

export const QUOTE_OWNER_COOKIE = "dih_quote";

/** A week: long enough to come back tomorrow and book, short enough for a shared laptop. */
export const QUOTE_OWNER_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Only the latest few quotes are remembered. */
const MAX_QUOTES = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const decoder = new TextDecoder();

const mac = (secret: string, payload: string) => hmacSha256Hex(secret, `quote-owner.${payload}`);

/** The quote ids in a cookie value, or [] when missing, tampered with, signed with another secret, or expired. */
export async function readQuoteOwner(
  token: string | null | undefined,
  opts: { secret?: string | null; nowMs?: number } = {},
): Promise<string[]> {
  if (!token || token.length > 2048) return [];
  const secret = opts.secret === undefined ? sessionSecret() : opts.secret;
  if (!secret) return [];
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return [];
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig) || !constantTimeEqual(sig, await mac(secret, payload))) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(base64urlDecode(payload)));
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const { q, exp } = parsed as { q?: unknown; exp?: unknown };
  if (typeof exp !== "number" || exp <= Math.floor((opts.nowMs ?? Date.now()) / 1000)) return [];
  if (!Array.isArray(q)) return [];
  return q.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)).slice(0, MAX_QUOTES);
}

/** A cookie value adding `quoteId` to the ones already held (newest first, capped), valid for a fresh week. */
export async function signQuoteOwner(
  quoteId: string,
  existing: string[] = [],
  opts: { secret?: string | null; nowMs?: number } = {},
): Promise<string | null> {
  const secret = opts.secret === undefined ? sessionSecret() : opts.secret;
  if (!secret) return null;
  const id = quoteId.toLowerCase();
  const q = [id, ...existing.filter((x) => x !== id)].slice(0, MAX_QUOTES);
  const exp = Math.floor((opts.nowMs ?? Date.now()) / 1000) + QUOTE_OWNER_TTL_SECONDS;
  const payload = base64urlEncode(JSON.stringify({ q, exp }));
  return `${payload}.${await mac(secret, payload)}`;
}

/** Cookie attributes: httpOnly, Lax, Secure in production, a week. */
export function quoteOwnerCookieOptions(env: Record<string, string | undefined> = process.env) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: QUOTE_OWNER_TTL_SECONDS,
  };
}
