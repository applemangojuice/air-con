"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { breakGlassLimits, isPlausibleEmail, normaliseEmail, safeNextPath, signInCodeLimits, staffLanding } from "@/lib/auth/access";
import { isDemoRoleKey } from "@/lib/auth/demo-staff";
import { consumeSignInCode, issueMagicLink } from "@/lib/auth/magic";
import { signInSubject } from "@/lib/auth/sign-in";
import { breakGlassSession, ensureDemoStaff, setSession, staffSession } from "@/lib/auth/server";
import { emailConfigured } from "@/lib/email";
import { demoModeAllowed } from "@/lib/auth/demo-guard";
import { rateLimitIdentity } from "@/lib/rate-limit";
import { sharedRateLimits } from "@/lib/rate-limit-shared";
import { pilotSchemaStatus } from "@/lib/schema-check";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Staff sign-in actions. Server actions carry Next's own same-origin check;
 * the rate limits below are a brake on guessing and inbox flooding, shared by
 * every instance (lib/rate-limit-shared). For break-glass they're scoped to
 * the caller's own network (`breakGlassLimits`), so nobody can lock the
 * founders out; the real protection is the password itself: at least 20
 * characters, never a template value, or it's off.
 */

export interface LinkState {
  status: "idle" | "sent" | "error";
  message?: string;
  devLink?: string;
  /** With `devLink` only (development, or a DEMO account on a demo deployment): the code that email would carry. */
  devCode?: string;
  email?: string;
  /** Whether an email provider is configured at all (the same for every address, so no hint). */
  emailLive?: boolean;
}

export interface CodeState {
  status: "idle" | "error";
  message?: string;
}

export interface BreakGlassState {
  status: "idle" | "error";
  message?: string;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return rateLimitIdentity(h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown");
}

const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export async function requestMagicLink(_prev: LinkState, form: FormData): Promise<LinkState> {
  const email = normaliseEmail(field(form, "email"));
  const next = safeNextPath(field(form, "next"), "");
  if (!isPlausibleEmail(email)) {
    return { status: "error", message: "That doesn't look like an email address.", email };
  }
  if (!getServiceClient()) {
    return {
      status: "error",
      message: "Sign-in links need a database, and this deployment doesn't have one connected.",
      email,
    };
  }
  const ip = await clientIp();
  // Shared by every instance (rate-limit-shared): each request is an email to someone's inbox.
  const limited = await sharedRateLimits([
    { key: `magic-ip:${ip}`, limit: 10, windowMs: 15 * 60_000 },
    { key: `magic-email:${email}`, limit: 5, windowMs: 15 * 60_000 },
  ]);
  if (!limited.ok) {
    return { status: "error", message: "Too many sign-in requests. Give it a few minutes and try again.", email };
  }
  try {
    const result = await issueMagicLink({ email, kind: "staff", next: next || undefined });
    return {
      status: "sent",
      email,
      emailLive: emailConfigured(),
      ...(result.devLink ? { devLink: result.devLink, ...(result.devCode ? { devCode: result.devCode } : {}) } : {}),
    };
  } catch (err) {
    console.error("[login] magic link failed:", err);
    // Not a passing hiccup: the pilot migration hasn't been run (the banner above says how to fix it).
    const schema = await pilotSchemaStatus().catch(() => null);
    if ([...(schema?.missingTables ?? []), ...(schema?.deniedTables ?? [])].some((t) => t === "staff" || t === "login_tokens")) {
      return { status: "error", message: "Sign-in isn't set up on this database yet: its pilot migration hasn't been run (see the note above).", email };
    }
    return { status: "error", message: "We couldn't send a link just now. Please try again.", email };
  }
}

/**
 * The 6-digit code from a sign-in email (§K45), typed in the browser the
 * person wants to be signed in on (the Home Screen app, say, when the email
 * app opened the link in its own). Bound to the address it was sent to;
 * every attempt counts against that address and the network first
 * (`signInCodeLimits`); it signs in exactly as the link would and spends it.
 */
export async function signInWithCode(_prev: CodeState, form: FormData): Promise<CodeState> {
  const email = normaliseEmail(field(form, "email")).slice(0, 254);
  if (!isPlausibleEmail(email)) return { status: "error", message: "Ask for a sign-in email first." };
  if (!getServiceClient()) return { status: "error", message: "Sign-in needs a database, and this deployment doesn't have one connected." };
  const limited = await sharedRateLimits(signInCodeLimits(await clientIp(), "staff", email));
  if (!limited.ok) {
    return { status: "error", message: "Too many tries for now. Tap the link in the email instead, or wait 15 minutes and ask for a new one." };
  }
  let subject;
  try {
    subject = await consumeSignInCode({ email, kind: "staff", code: field(form, "code") });
  } catch (err) {
    console.error("[login] sign-in code check failed:", err);
    return { status: "error", message: "Signing in isn't working right now. Please try the link in the email." };
  }
  const wrong = "That code didn't work. Check it against the newest email (codes last 15 minutes and work once), or tap the link in it instead.";
  if (!subject) return { status: "error", message: wrong };
  const signIn = await signInSubject(subject, "code");
  if (!signIn.ok) return { status: "error", message: wrong };
  try {
    await setSession(signIn.session);
  } catch (err) {
    console.error("[login] could not sign a session:", err);
    return { status: "error", message: "Signing in isn't working right now. Please try the link in the email." };
  }
  await signIn.record();
  // Where the email's link was going (the `next` this page asked for when it sent it).
  redirect(signIn.landing);
}

export async function demoSignIn(form: FormData): Promise<void> {
  const role = field(form, "role");
  if (!isDemoRoleKey(role) || !(await demoModeAllowed())) redirect("/login");
  const team = await ensureDemoStaff();
  const staff = team[role];
  await setSession(staffSession(staff));
  await audit({ actor: staff, action: "auth.demo-sign-in", entity: "staff", entityId: staff.id, detail: { role } });
  redirect(staffLanding(staff, field(form, "next")));
}

export async function breakGlassSignIn(_prev: BreakGlassState, form: FormData): Promise<BreakGlassState> {
  const email = normaliseEmail(field(form, "email")).slice(0, 254);
  const password = String(form.get("password") ?? "");
  const ip = await clientIp();
  const limited = !(await sharedRateLimits(breakGlassLimits(ip, email))).ok;
  // Refusals over the limit aren't audited (that would let a flood write rows);
  // every attempt that's actually checked is.
  if (limited) {
    return { status: "error", message: "Too many attempts. Wait a while and try again, or ask for a sign-in link." };
  }
  const session = await breakGlassSession(email, password);
  if (!session) {
    // Every failure is recorded: a run of these is someone guessing.
    await audit({
      actor: { kind: "system", name: "break-glass" },
      action: "auth.break-glass-failed",
      entity: "staff",
      detail: { email, ip },
    });
    return { status: "error", message: "That email and password don't open the admin console." };
  }
  await setSession(session);
  redirect(safeNextPath(field(form, "next"), "/ops"));
}
