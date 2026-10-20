import { migrateProject } from "@aircon/domain";
import { appUrl } from "@/lib/brand";
import { notify } from "@/lib/comms/outbox";
import { emailConfigured } from "@/lib/email";
import { spendEmailBudget, type EmailPool } from "@/lib/email-budget";
import * as customersRepo from "@/lib/repo/customers";
import * as staffRepo from "@/lib/repo/staff";
import * as tokensRepo from "@/lib/repo/tokens";
import { requireDb } from "@/lib/supabase-server";
import { withLegacyContact } from "@/lib/legacy-contact";
import {
  SIGN_IN_CODE_DIGITS,
  SIGN_IN_CODE_MAX_MINUTES,
  isAdminEmail,
  isPlausibleEmail,
  linkMayCarryToken,
  linkMayShowOnScreen,
  normaliseEmail,
  normaliseSignInCode,
  safeNextPath,
  signInCodeMinutes,
} from "./access";
import { base64urlEncode, constantTimeEqual, hmacSha256Hex, sessionSecret } from "./session";

/**
 * Magic links (contract §C). A link carries a random token; the database
 * keeps only sha256(token), the subject, where to land and when it dies.
 *
 *  * Staff links last 20 minutes. Customer sign-in links last an hour.
 *  * Links inside customer operational emails (`customerLink`) last 30 days,
 *    one fresh token per send, single use: a lost link means asking for
 *    another, never a password. They only ever go to the customer's own
 *    address, and are minted when the email is sent, never stored.
 *  * Sending goes through the outbox (`magic-link` event). Where email
 *    isn't configured the link comes back for the screen instead, but only
 *    on a developer's machine, or on a demo deployment for DEMO accounts and
 *    reserved addresses (example.com, .invalid, …) no real person can own:
 *    showing a real person's link on screen would let anyone sign in as them.
 *  * Unknown and inactive addresses get no link and no hint (the page says
 *    the same thing either way).
 *  * Every sign-in email also carries a 6-digit code (§K45) for signing in
 *    in another browser (an email app's own, the Home Screen web app). It's
 *    never stored: it's derived from the token's stored hash with the
 *    session secret, so a database copy alone can't produce one. It lasts
 *    as long as the link or 15 minutes, whichever is shorter; only the
 *    newest one for an address works; using either the code or the link
 *    spends both (one row, one `used_at`).
 */

export const STAFF_LINK_TTL_MINUTES = 20;
/** Sign-in emails to one address per quarter hour, counted in the database (every instance sees the same count). */
export const SIGN_IN_LINKS_PER_ADDRESS = 6;
const SIGN_IN_WINDOW_MS = 15 * 60_000;
/** And per day: however the quarter hours are spaced, one inbox gets at most this many sign-in emails a day. */
export const SIGN_IN_LINKS_PER_ADDRESS_PER_DAY = 20;
const SIGN_IN_DAY_MS = 24 * 60 * 60_000;
export const CUSTOMER_SIGNIN_TTL_MINUTES = 60;
export const CUSTOMER_EMAIL_LINK_TTL_DAYS = 30;

/** 32 random bytes, base64url: 256 bits, unguessable. */
export function generateToken(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Where a token is exchanged for a session (relative: for the screen). */
export function verifyPath(rawToken: string): string {
  return `/auth/verify?t=${encodeURIComponent(rawToken)}`;
}

/** The absolute link an email carries. */
export function verifyUrl(rawToken: string): string {
  return `${appUrl()}${verifyPath(rawToken)}`;
}

/** Store a fresh token and return the raw value (never stored) and its link. */
async function createToken(input: {
  kind: "staff" | "customer";
  subjectId: string | null;
  email: string;
  next?: string;
  ttlMinutes: number;
  /** A sign-in email's token, whose email carries a code too. */
  withCode?: boolean;
}): Promise<{ raw: string; hash: string; link: string; tokenId: string; expiresAt: string }> {
  const raw = generateToken();
  const hash = await hashToken(raw);
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000).toISOString();
  const row = await tokensRepo.insert({
    tokenHash: hash,
    subjectKind: input.kind,
    subjectId: input.subjectId,
    email: input.email,
    purpose: input.withCode ? tokensRepo.SIGN_IN_CODE_PURPOSE : "login",
    ...(input.next ? { nextPath: input.next } : {}),
    expiresAt,
  });
  return { raw, hash, link: verifyUrl(raw), tokenId: row.id, expiresAt };
}

/**
 * A token's 6-digit code: HMAC-SHA256 of its stored hash and address under
 * the session secret, 48 bits of it reduced to six digits. Deterministic, so
 * nothing extra is stored; keyed, so the hash in the database isn't enough
 * to work it out. Null without a usable secret (then nobody can sign in anyway).
 */
export async function signInCodeFor(tokenHash: string, email: string, secret: string | null = sessionSecret()): Promise<string | null> {
  if (!secret) return null;
  const mac = await hmacSha256Hex(secret, `dih-sign-in-code:${tokenHash}:${normaliseEmail(email)}`);
  return (Number.parseInt(mac.slice(0, 12), 16) % 10 ** SIGN_IN_CODE_DIGITS).toString().padStart(SIGN_IN_CODE_DIGITS, "0");
}

/**
 * Email a sign-in link. `sent` is true only when an email provider took it;
 * `devLink` is the link itself, for the screen, when no provider is set up
 * and showing it is safe (see the module comment).
 */
export async function issueMagicLink(input: {
  email: string;
  kind: "staff" | "customer";
  next?: string;
  ttlMinutes?: number;
  /**
   * A link someone asked for without signing in: spent from that shared
   * email budget (lib/email-budget.ts) once it's known a link would go.
   * Over it, nothing is sent (`heldBack`), with the same answer as any refusal.
   */
  budget?: EmailPool;
}): Promise<{ sent: boolean; devLink?: string; devCode?: string; heldBack?: boolean }> {
  const email = normaliseEmail(input.email);
  if (!isPlausibleEmail(email)) return { sent: false };
  requireDb();

  let subjectId: string | null = null;
  let name = "";
  let isDemo = false;
  if (input.kind === "staff") {
    const staff = await staffRepo.getByEmail(email);
    if (staff) {
      if (!staff.active) return { sent: false };
      subjectId = staff.id;
      name = staff.name;
      isDemo = staff.demo === true;
    } else if (!isAdminEmail(email, process.env.ADMIN_EMAILS)) {
      return { sent: false }; // first sign-in from an ADMIN_EMAILS address bootstraps at /auth/verify
    }
  } else {
    const customer = await customersRepo.getByEmail(email);
    if (!customer) return { sent: false };
    subjectId = customer.id;
    name = customer.name ?? "";
  }

  const ttlMinutes =
    input.ttlMinutes ?? (input.kind === "staff" ? STAFF_LINK_TTL_MINUTES : CUSTOMER_SIGNIN_TTL_MINUTES);
  // A brake on anyone sending one address a pile of sign-in emails (and on
  // spending the email quota everything shares). Same answer as any refusal.
  const now = new Date();
  const count = (windowMs: number) =>
    tokensRepo.recentSignInLinks(email, new Date(now.getTime() - windowMs).toISOString(), now.toISOString()).catch((err) => {
      console.error("[auth] sign-in link count failed (continuing):", err);
      return 0;
    });
  const [recent, today] = await Promise.all([count(SIGN_IN_WINDOW_MS), count(SIGN_IN_DAY_MS)]);
  if (recent >= SIGN_IN_LINKS_PER_ADDRESS) {
    console.warn(`[auth] sign-in links to one address held back: ${recent} in the last 15 minutes`);
    return { sent: false };
  }
  if (today >= SIGN_IN_LINKS_PER_ADDRESS_PER_DAY) {
    console.warn(`[auth] sign-in links to one address held back: ${today} in the last 24 hours`);
    return { sent: false };
  }
  if (input.budget && !(await spendEmailBudget(input.budget))) return { sent: false, heldBack: true };
  const next = input.next ? safeNextPath(input.next, "") || undefined : undefined;
  const token = await createToken({ kind: input.kind, subjectId, email, next, ttlMinutes, withCode: true });
  const code = await signInCodeFor(token.hash, email);

  const live = emailConfigured();
  let sent = false;
  try {
    const result = await notify("magic-link", {
      to: email,
      data: {
        link: token.link,
        name: name || undefined,
        audience: input.kind,
        expiresInMinutes: ttlMinutes,
        ...(code ? { code, codeMinutes: signInCodeMinutes(ttlMinutes) } : {}),
      },
      discriminator: token.tokenId,
    });
    // Honest: "sent" only on a provider acknowledgement, never "demo" or "queued".
    sent = result.status === "sent";
  } catch (err) {
    console.error("[auth] magic link send failed:", err);
  }

  // Relative, so the on-screen link works on whatever host is serving this page.
  return linkMayShowOnScreen({ env: process.env, emailLive: live, email, demoAccount: isDemo })
    ? { sent, devLink: verifyPath(token.raw), ...(code ? { devCode: code } : {}) }
    : { sent };
}

/**
 * An absolute link into a customer's project for an operational email to
 * `recipient`, carrying a fresh 30-day single-use sign-in token, or the plain
 * page URL (no sign-in) when a token can't safely go there.
 *
 * A token signs in as the project's customer record, which may own other
 * projects too, so it only ever goes to that customer's own address. Any
 * other recipient (a stale address, a correction staff made, a mismatch from
 * a quote submitted under someone else's email) gets the plain URL and signs
 * in the normal way. A project with no customer yet is attached to a new
 * record for its own email (a v1 project: its quote's email) on first use;
 * when the address already has a record, the token signs in as that
 * customer and the project joins them only once they use it.
 */
export async function customerLink(projectId: string, path: string, recipient: string): Promise<string> {
  const target = safeNextPath(path, `/p/${projectId}`);
  const plain = `${appUrl()}${target}`;
  const to = normaliseEmail(recipient ?? "");
  if (!isPlausibleEmail(to)) return plain;
  const db = requireDb();

  const { data: row } = await db
    .from("projects")
    .select("id, quote_id, customer_id, project")
    .eq("id", projectId)
    .maybeSingle();
  if (!row) {
    console.warn(`[auth] customerLink: project ${projectId} not found`);
    return plain;
  }

  let customer = row.customer_id ? await customersRepo.get(String(row.customer_id)) : null;
  if (!customer) {
    let project;
    try {
      project = await withLegacyContact(db, migrateProject(row.project), row.project, (row.quote_id as string | null) ?? null);
    } catch {
      return plain; // unreadable snapshot: no identity to attach
    }
    const email = project.customer.email;
    if (!email || !linkMayCarryToken(email, to)) return plain;
    // An address that's already a customer's, typed into the funnel: the link
    // signs in as them, and the project joins them only when they use it
    // (project-service claimProjectOnSignIn, at /auth/verify).
    customer = await customersRepo.getByEmail(email);
    if (!customer) {
      customer = await customersRepo.findOrCreate({
        email,
        name: project.customer.name || undefined,
        phone: project.customer.phone,
      });
      await db.from("projects").update({ customer_id: customer.id }).eq("id", projectId).is("customer_id", null);
    }
  }

  if (!linkMayCarryToken(customer.email, to)) {
    console.warn(`[auth] customerLink: ${projectId}'s customer isn't the recipient; sending a plain link`);
    return plain;
  }
  const token = await createToken({
    kind: "customer",
    subjectId: customer.id,
    email: customer.email,
    next: target,
    ttlMinutes: CUSTOMER_EMAIL_LINK_TTL_DAYS * 24 * 60,
  });
  return token.link;
}

export interface TokenSubject {
  kind: "staff" | "customer";
  /** Null only for a first admin sign-in (no staff row yet). */
  subjectId: string | null;
  email: string;
  next?: string;
}

/** The live (unused, unexpired) token row for a raw token, or null. Never spends it. */
async function liveToken(raw: string | null | undefined, now: Date) {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const row = await tokensRepo.findByHash(await hashToken(raw));
  if (!row || row.usedAt) return null;
  return new Date(row.expiresAt).getTime() > now.getTime() ? row : null;
}

/**
 * What we know of a token that can't sign anyone in (already used, or
 * expired but not yet swept away): its kind, subject and landing page, so a
 * dead link can still send someone somewhere sensible (deadLinkLanding).
 * Null when it was never ours.
 */
export async function deadTokenSubject(raw: string | null | undefined): Promise<TokenSubject | null> {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const row = await tokensRepo.findByHash(await hashToken(raw));
  return row ? { kind: row.subjectKind, subjectId: row.subjectId, email: row.email, ...(row.nextPath ? { next: row.nextPath } : {}) } : null;
}

/**
 * Who a token would sign in, without spending it: for the confirm page,
 * which says "Continue as j***@example.com" before anything happens.
 */
export async function peekToken(raw: string | null | undefined): Promise<TokenSubject | null> {
  const row = await liveToken(raw, new Date());
  return row ? { kind: row.subjectKind, subjectId: row.subjectId, email: row.email } : null;
}

/**
 * Exchange a raw token for its subject, exactly once. Null when unknown,
 * expired or already used; on success the token is spent.
 */
export async function consumeToken(raw: string | null | undefined): Promise<TokenSubject | null> {
  const now = new Date();
  const row = await liveToken(raw, now);
  if (!row) return null;
  if (!(await tokensRepo.markUsed(row.id, now.toISOString()))) return null;
  return {
    kind: row.subjectKind,
    subjectId: row.subjectId,
    email: row.email,
    ...(row.nextPath ? { next: row.nextPath } : {}),
  };
}

/**
 * Exchange a typed code for its token's subject, exactly once: only the
 * newest sign-in email's code for this address and kind, inside its life
 * (the link's, or 15 minutes, whichever is shorter), compared in constant
 * time. On success the token is spent, so its link is dead too. Null for
 * anything else, with no hint which: the caller counts the attempt first
 * (signInCodeLimits).
 */
export async function consumeSignInCode(input: { email: string; kind: "staff" | "customer"; code: string }): Promise<TokenSubject | null> {
  const email = normaliseEmail(input.email);
  const code = normaliseSignInCode(input.code);
  if (!code || !isPlausibleEmail(email)) return null;
  const now = new Date();
  const since = new Date(now.getTime() - SIGN_IN_CODE_MAX_MINUTES * 60_000).toISOString();
  const row = await tokensRepo.newestWithCode(email, input.kind, since, now.toISOString());
  if (!row || row.usedAt) return null;
  const created = Date.parse(row.createdAt ?? "");
  const lifeMinutes = (Date.parse(row.expiresAt) - created) / 60_000;
  if (!Number.isFinite(created) || now.getTime() >= created + signInCodeMinutes(lifeMinutes) * 60_000) return null;
  const expected = await signInCodeFor(row.tokenHash, row.email);
  if (!expected || !constantTimeEqual(expected, code)) return null;
  if (!(await tokensRepo.markUsed(row.id, now.toISOString()))) return null;
  return {
    kind: row.subjectKind,
    subjectId: row.subjectId,
    email: row.email,
    ...(row.nextPath ? { next: row.nextPath } : {}),
  };
}
