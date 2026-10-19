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

/** Staff stay signed in on their phone for 30 days (plan §7.2). */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** `exp` is seconds since the Unix epoch, as in a JWT. */
export type StaffSession = {
  kind: "staff";
  staffId: string;
  email: string;
  name: string;
  roles: StaffRole[];
  external: boolean;
  exp: number;
};

export type CustomerSession = {
  kind: "customer";
  customerId: string;
  email: string;
  name: string;
  projectIds: string[];
  exp: number;
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
