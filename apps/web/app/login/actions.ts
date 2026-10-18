"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { isPlausibleEmail, normaliseEmail, safeNextPath, staffLanding } from "@/lib/auth/access";
import { isDemoRoleKey } from "@/lib/auth/demo-staff";
import { issueMagicLink } from "@/lib/auth/magic";
import { breakGlassSession, ensureDemoStaff, setSession, staffSession } from "@/lib/auth/server";
import { emailConfigured } from "@/lib/email";
import { isDemoLoginAllowed } from "@/lib/env-mode";
import { rateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Staff sign-in actions. Server actions carry Next's own same-origin check;
 * the rate limits below are a brake on guessing and inbox flooding.
 */

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
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
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
  if (!rateLimit(`magic-ip:${ip}`, 10, 15 * 60_000).ok || !rateLimit(`magic-email:${email}`, 5, 15 * 60_000).ok) {
    return { status: "error", message: "Too many sign-in requests. Give it a few minutes and try again.", email };
  }
  try {
    const result = await issueMagicLink({ email, kind: "staff", next: next || undefined });
    return { status: "sent", email, emailLive: emailConfigured(), ...(result.devLink ? { devLink: result.devLink } : {}) };
  } catch (err) {
    console.error("[login] magic link failed:", err);
    return { status: "error", message: "We couldn't send a link just now. Please try again.", email };
  }
}

export async function demoSignIn(form: FormData): Promise<void> {
  const role = field(form, "role");
  if (!isDemoLoginAllowed() || !isDemoRoleKey(role)) redirect("/login");
  const team = await ensureDemoStaff();
  const staff = team[role];
  await setSession(staffSession(staff));
  await audit({ actor: staff, action: "auth.demo-sign-in", entity: "staff", entityId: staff.id, detail: { role } });
  redirect(staffLanding(staff, field(form, "next")));
}

export async function breakGlassSignIn(_prev: BreakGlassState, form: FormData): Promise<BreakGlassState> {
  const email = normaliseEmail(field(form, "email"));
  const password = String(form.get("password") ?? "");
  const ip = await clientIp();
  if (!rateLimit(`break-glass:${ip}`, 5, 15 * 60_000).ok) {
    return { status: "error", message: "Too many attempts. Wait 15 minutes and try again." };
  }
  const session = await breakGlassSession(email, password);
  if (!session) {
    return { status: "error", message: "That email and password don't open the admin console." };
  }
  await setSession(session);
  redirect(safeNextPath(field(form, "next"), "/ops"));
}
