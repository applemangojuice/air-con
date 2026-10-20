import type { StaffRole } from "@aircon/domain";
import { isPlaceholderValue } from "../env-placeholders.ts";

/**
 * The signed session cookie (contract §C). Edge-safe: Web Crypto, TextEncoder
 * and btoa/atob only, so middleware can verify it without a database call.
 *
 *   dih_session = base64url(JSON payload) + "." + hex(HMAC-SHA256(secret, base64url payload))
 *
 * The cookie says who signed in and when it expires; it is not the authority
 * on what they may do. Server code reloads staff from the database on every
 * request (lib/auth/server.ts), so a role change or a deactivation applies
 * at once, not when the cookie runs out.
 *
 * Self-contained (type-only imports), so `node --test` loads it directly.
 */

export const SESSION_COOKIE = "dih_session";

/** Staff stay signed in on their phone for 30 days (plan §7.2), renewed as they use it (below). */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Rolling staff sessions (§K45): once more than half a session's life has
 * passed, using the app re-signs the cookie for another 30 days, but never
 * past this long after the original sign-in. So a crew isn't signed out
 * mid-job, and a stolen cookie still dies within 90 days of the sign-in it
 * came from, however it's used.
 */
export const SESSION_MAX_SECONDS = 90 * 24 * 60 * 60;

/**
 * `exp` is seconds since the Unix epoch, as in a JWT. `iat` is when this
 * cookie was signed and `auth` when the person actually signed in (both
 * seconds); cookies from before renewals have neither and never renew.
 */
export type StaffSession = {
  kind: "staff";
  staffId: string;
  email: string;
  name: string;
  roles: StaffRole[];
  external: boolean;
  exp: number;
  iat?: number;
  auth?: number;
};

export type CustomerSession = {
  kind: "customer";
  customerId: string;
  email: string;
  name: string;
  projectIds: string[];
  exp: number;
  iat?: number;
  auth?: number;
};

export type Session = StaffSession | CustomerSession;

/** Anyone can read this constant in the repo, so it only ever signs outside production. */
const DEV_FALLBACK_SECRET = "dih-dev-session-secret-not-for-production";

/**
 * Production refuses a SESSION_SECRET shorter than this. Anyone can get a
 * validly signed cookie (any customer link), and with a short secret an
 * offline HMAC search recovers it, which forges an admin session. Generate
 * one with `openssl rand -hex 32` (64 characters).
 */
export const MIN_SESSION_SECRET_LENGTH = 32;

let warnedFallback = false;
let warnedWeak = false;

/** Is SESSION_SECRET set and strong enough for this environment? (The status page asks.) */
export function sessionSecretUsable(env: Record<string, string | undefined> = process.env): boolean {
  const configured = env.SESSION_SECRET ?? "";
  // The template's own value is public (it's in the repo): never a secret.
  if (isPlaceholderValue(configured)) return false;
  return configured.length >= (env.NODE_ENV === "production" ? MIN_SESSION_SECRET_LENGTH : 1);
}

/**
 * SESSION_SECRET, else the dev fallback outside production (with a one-time
 * warning), else null: production never signs or trusts a cookie without a
 * real secret, and treats a short one as unset.
 */
export function sessionSecret(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.SESSION_SECRET;
  if (configured && sessionSecretUsable(env)) return configured;
  if (env.NODE_ENV === "production") {
    if (configured && !warnedWeak) {
      warnedWeak = true;
      console.error(
        isPlaceholderValue(configured)
          ? "[auth] SESSION_SECRET is still the .env.example placeholder, so it's ignored and nobody can sign in. Generate one with: openssl rand -hex 32"
          : `[auth] SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_LENGTH} characters, so it's ignored and nobody can sign in. Generate one with: openssl rand -hex 32`,
      );
    }
    return null;
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn("[auth] SESSION_SECRET not set: signing sessions with the dev fallback secret.");
  }
  return DEV_FALLBACK_SECRET;
}

/** Expiry for a session issued now. */
export function sessionExpiry(nowMs: number = Date.now(), ttlSeconds: number = SESSION_TTL_SECONDS): number {
  return Math.floor(nowMs / 1000) + ttlSeconds;
}

/* ------------------------------------------------------------------ */
/* Encoding                                                            */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64urlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Bytes from base64url (padding optional). Throws on characters outside the alphabet. */
export function base64urlDecode(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) throw new Error("not base64url");
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

/** Compares every character whatever the input, so timing says nothing about where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/* ------------------------------------------------------------------ */
/* Sign + verify                                                       */
/* ------------------------------------------------------------------ */

/** The cookie value. Throws without a usable secret (production with no SESSION_SECRET). */
export async function signSession(session: Session, secret: string | null = sessionSecret()): Promise<string> {
  if (!secret) throw new Error("SESSION_SECRET is not set: refusing to sign a session in production.");
  const payload = base64urlEncode(JSON.stringify(session));
  return `${payload}.${await hmacSha256Hex(secret, payload)}`;
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
/** `iat` and `auth` when the payload has them (both, or neither), so old cookies read exactly as before. */
const times = (r: Record<string, unknown>): { iat?: number; auth?: number } =>
  isTime(r.iat) && isTime(r.auth) ? { iat: r.iat, auth: r.auth } : {};
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** A signature alone isn't enough: the payload must also have the exact session shape. */
function asSession(raw: unknown): Session | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.exp !== "number" || !Number.isFinite(r.exp) || !isStr(r.email) || typeof r.name !== "string") {
    return null;
  }
  if (r.kind === "staff" && isStr(r.staffId) && isStrArray(r.roles) && typeof r.external === "boolean") {
    return {
      kind: "staff",
      staffId: r.staffId,
      email: r.email,
      name: r.name,
      roles: r.roles as StaffRole[],
      external: r.external,
      exp: r.exp,
      ...times(r),
    };
  }
  if (r.kind === "customer" && isStr(r.customerId) && isStrArray(r.projectIds)) {
    return {
      kind: "customer",
      customerId: r.customerId,
      email: r.email,
      name: r.name,
      projectIds: r.projectIds,
      exp: r.exp,
      ...times(r),
    };
  }
  return null;
}

/**
 * The session in a cookie value, or null when it's missing, malformed,
 * tampered with, signed with another secret, or expired.
 */
export async function verifySession(
  token: string | null | undefined,
  opts: { secret?: string | null; nowMs?: number } = {},
): Promise<Session | null> {
  if (!token || token.length > 8192) return null;
  const secret = opts.secret === undefined ? sessionSecret() : opts.secret;
  if (!secret) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  if (!constantTimeEqual(sig, await hmacSha256Hex(secret, payload))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(base64urlDecode(payload)));
  } catch {
    return null;
  }
  const session = asSession(parsed);
  if (!session) return null;
  const nowSeconds = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  return session.exp > nowSeconds ? session : null;
}

/** Cookie attributes for the session (httpOnly, Lax, Secure in production). */
export function sessionCookieOptions(env: Record<string, string | undefined> = process.env) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/* ------------------------------------------------------------------ */
/* Renewal (§K45)                                                      */
/* ------------------------------------------------------------------ */

/**
 * When this staff session can next be renewed (seconds), or null when it
 * never can: a customer's, a break-glass one (shorter than a normal
 * session: emergencies stay short), one from before renewals (no
 * `iat`/`auth`), or one already at its 90-day cap.
 */
export function renewableFrom(session: Session): number | null {
  if (session.kind !== "staff" || session.iat === undefined || session.auth === undefined) return null;
  const life = session.exp - session.iat;
  if (life < SESSION_TTL_SECONDS) return null;
  if (session.exp >= session.auth + SESSION_MAX_SECONDS) return null;
  return session.iat + Math.floor(life / 2);
}

/** The latest a session can last, however it's used: 90 days after the sign-in (or its own expiry, if it never renews). */
export function sessionHardEnd(session: Session): number {
  return session.kind === "staff" && renewableFrom(session) !== null && session.auth !== undefined
    ? session.auth + SESSION_MAX_SECONDS
    : session.exp;
}

/**
 * The same session re-signed for another 30 days from now (capped at 90
 * days from the sign-in), or null when it isn't due or can't renew. The
 * caller has already checked the person is still an active staff member:
 * renewing never brings back anyone the database refuses.
 */
export function renewedSession(session: Session, nowMs: number = Date.now()): StaffSession | null {
  const from = renewableFrom(session);
  if (from === null || session.kind !== "staff" || session.auth === undefined) return null;
  const now = Math.floor(nowMs / 1000);
  if (now < from || now >= session.exp) return null;
  const exp = Math.min(now + SESSION_TTL_SECONDS, session.auth + SESSION_MAX_SECONDS);
  if (exp <= session.exp) return null;
  return { ...session, iat: now, exp };
}
