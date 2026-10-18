import { migrateProject } from "@aircon/domain";
import { appUrl } from "@/lib/brand";
import { notify } from "@/lib/comms/outbox";
import { emailConfigured } from "@/lib/email";
import * as customersRepo from "@/lib/repo/customers";
import * as staffRepo from "@/lib/repo/staff";
import * as tokensRepo from "@/lib/repo/tokens";
import { requireDb } from "@/lib/supabase-server";
import { isAdminEmail, isPlausibleEmail, normaliseEmail, safeNextPath } from "./access";
import { base64urlEncode } from "./session";

/**
 * Magic links (contract §C). A link carries a random token; the database
 * keeps only sha256(token), the subject, where to land and when it dies.
 *
 *  * Staff links last 20 minutes. Customer sign-in links last an hour.
 *  * Links inside customer operational emails (`customerLink`) last 30 days,
 *    one fresh token per send, single use: a lost link means asking for
 *    another, never a password.
 *  * Sending goes through the outbox (`magic-link` event). Where email
 *    isn't configured the link comes back for the screen instead, but only
 *    on a developer's machine, or for DEMO accounts on a demo deployment:
 *    showing a real person's link on screen would let anyone sign in as them.
 *  * Unknown and inactive addresses get no link and no hint (the page says
 *    the same thing either way).
 */

export const STAFF_LINK_TTL_MINUTES = 20;
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
}): Promise<{ raw: string; link: string; tokenId: string; expiresAt: string }> {
  const raw = generateToken();
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000).toISOString();
  const row = await tokensRepo.insert({
    tokenHash: await hashToken(raw),
    subjectKind: input.kind,
    subjectId: input.subjectId,
    email: input.email,
    purpose: "login",
    ...(input.next ? { nextPath: input.next } : {}),
    expiresAt,
  });
  return { raw, link: verifyUrl(raw), tokenId: row.id, expiresAt };
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
}): Promise<{ sent: boolean; devLink?: string }> {
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
  const next = input.next ? safeNextPath(input.next, "") || undefined : undefined;
  const token = await createToken({ kind: input.kind, subjectId, email, next, ttlMinutes });

  const live = emailConfigured();
  let sent = false;
  try {
    const result = await notify("magic-link", {
      to: email,
      data: { link: token.link, name: name || undefined, audience: input.kind, expiresInMinutes: ttlMinutes },
      discriminator: token.tokenId,
    });
    // Honest: "sent" only on a provider acknowledgement, never "demo" or "queued".
    sent = result.status === "sent";
  } catch (err) {
    console.error("[auth] magic link send failed:", err);
  }

  const onScreenAllowed =
    process.env.NODE_ENV !== "production" || (process.env.ALLOW_DEMO_LOGIN === "1" && isDemo);
  // Relative, so the on-screen link works on whatever host is serving this page.
  return !live && onScreenAllowed ? { sent, devLink: verifyPath(token.raw) } : { sent };
}

/**
 * An absolute link into a customer's project for an operational email,
 * carrying a fresh 30-day single-use sign-in token. Creates and attaches the
 * project's customer record from the project's email on first use. Falls
 * back to the plain page URL (no sign-in) when the project has no email yet.
 */
export async function customerLink(projectId: string, path: string): Promise<string> {
  const target = safeNextPath(path, `/p/${projectId}`);
  const plain = `${appUrl()}${target}`;
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
    let email: string | undefined;
    let name: string | undefined;
    let phone: string | undefined;
    try {
      const project = migrateProject(row.project);
      email = project.customer.email;
      name = project.customer.name || undefined;
      phone = project.customer.phone;
    } catch {
      // Unreadable snapshot: fall through to the quote's contact details.
    }
    if (!email && row.quote_id) {
      const { data: quote } = await db
        .from("quote_requests")
        .select("email, customer_name, phone")
        .eq("id", row.quote_id)
        .maybeSingle();
      email = (quote?.email as string | null) ?? undefined;
      name ??= (quote?.customer_name as string | null) ?? undefined;
      phone ??= (quote?.phone as string | null) ?? undefined;
    }
    if (!email || !isPlausibleEmail(normaliseEmail(email))) return plain;
    customer = await customersRepo.findOrCreate({ email, name, phone });
    await db.from("projects").update({ customer_id: customer.id }).eq("id", projectId).is("customer_id", null);
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

/**
 * Exchange a raw token for its subject, exactly once. Null when unknown,
 * expired or already used; on success the token is spent.
 */
export async function consumeToken(raw: string | null | undefined): Promise<TokenSubject | null> {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const row = await tokensRepo.findByHash(await hashToken(raw));
  if (!row || row.usedAt) return null;
  const now = new Date();
  if (!(new Date(row.expiresAt).getTime() > now.getTime())) return null;
  if (!(await tokensRepo.markUsed(row.id, now.toISOString()))) return null;
  return {
    kind: row.subjectKind,
    subjectId: row.subjectId,
    email: row.email,
    ...(row.nextPath ? { next: row.nextPath } : {}),
  };
}
