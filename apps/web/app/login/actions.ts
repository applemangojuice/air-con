"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { isPlausibleEmail, normaliseEmail, safeNextPath, staffLanding } from "@/lib/auth/access";
import { isDemoRoleKey } from "@/lib/auth/demo-staff";
import { issueMagicLink } from "@/lib/auth/magic";
import { breakGlassSession, ensureDemoStaff, setSession, staffSession } from "@/lib/auth/server";
import { emailConfigured } from "@/lib/email";
import { demoModeAllowed } from "@/lib/auth/demo-guard";
import { rateLimitIdentity } from "@/lib/rate-limit";
import { sharedRateLimits } from "@/lib/rate-limit-shared";
import { pilotSchemaStatus } from "@/lib/schema-check";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Staff sign-in actions. Server actions carry Next's own same-origin check;
 * the rate limits below are a brake on guessing and inbox flooding. They're
 * in-memory per instance (lib/rate-limit), so for break-glass the real
 * protection is the password itself: at least 20 characters or it's off.
 */

/** Break-glass: per address (IPv6 by /64), per email, and across everyone. */
const BREAK_GLASS_LIMITS = {
  perIp: { limit: 5, windowMs: 15 * 60_000 },
  perEmail: { limit: 5, windowMs: 60 * 60_000 },
  global: { limit: 20, windowMs: 60 * 60_000 },
};

export interface LinkState {
  status: "idle" | "sent" | "error";
  message?: string;
  devLink?: string;
  email?: string;
  /** Whether an email provider is configured at all (the same for every address, so no hint). */
  emailLive?: boolean;
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
    return { status: "sent", email, emailLive: emailConfigured(), ...(result.devLink ? { devLink: result.devLink } : {}) };
  } catch (err) {
    console.error("[login] magic link failed:", err);
    // Not a passing hiccup: the pilot migration hasn't been run (the banner above says how to fix it).
    const schema = await pilotSchemaStatus().catch(() => null);
    if (schema?.missingTables.some((t) => t === "staff" || t === "login_tokens")) {
      return { status: "error", message: "Sign-in isn't set up on this database yet: its pilot migration hasn't been run (see the note above).", email };
    }
    return { status: "error", message: "We couldn't send a link just now. Please try again.", email };
  }
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
  const { perIp, perEmail, global } = BREAK_GLASS_LIMITS;
  const limited = !(
    await sharedRateLimits([
      { key: "break-glass:all", limit: global.limit, windowMs: global.windowMs },
      { key: `break-glass:${ip}`, limit: perIp.limit, windowMs: perIp.windowMs },
      { key: `break-glass-email:${email}`, limit: perEmail.limit, windowMs: perEmail.windowMs },
    ])
  ).ok;
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
