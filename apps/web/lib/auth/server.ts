import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Permission, StaffMember } from "@aircon/domain";
import { audit } from "@/lib/audit";
import type { CustomerRecord } from "@/lib/repo/customers";
import { isUuid } from "@/lib/repo/base";
import * as staffRepo from "@/lib/repo/staff";
import { PILOT_MIGRATION, staffTableMissing } from "@/lib/schema-check";
import { getServiceClient } from "@/lib/supabase-server";
import {
  breakGlassEnabled,
  decideProjectAccess,
  decideStaffGate,
  demoLoginAllowed,
  isAdminEmail as isListedAdmin,
  normaliseEmail,
  safeNextPath,
  type AssignmentView,
  type ProjectAccess,
} from "./access";
import { demoModeAllowed } from "./demo-guard";
import { QUOTE_OWNER_COOKIE, readQuoteOwner } from "./quote-owner";
import { DEMO_STAFF, demoStaffById, isDemoStaffId, type DemoRoleKey } from "./demo-staff";
import {
  SESSION_COOKIE,
  constantTimeEqual,
  hmacSha256Hex,
  sessionCookieOptions,
  sessionExpiry,
  signSession,
  verifySession,
  type CustomerSession,
  type Session,
  type StaffSession,
} from "./session";

/**
 * Identity on the server (contract §C). Node only; middleware uses
 * lib/auth/session.ts directly.
 *
 * The cookie says who someone is. What they may do comes from the staff
 * table, read fresh on every request: a role change or a deactivation
 * applies at once. Every page, server action and API route that touches
 * pilot data calls one of the guards below; hiding a button is not a check.
 */

export type { ProjectAccess };

/** Break-glass sessions are for emergencies, so they're short. */
const BREAK_GLASS_TTL_SECONDS = 12 * 60 * 60;

/**
 * The synthetic admin a break-glass sign-in gets when there's no database to
 * hold a staff row (legacy demo mode: the ops console still opens).
 */
const BREAK_GLASS_STAFF_ID = "break-glass";

/* ------------------------------------------------------------------ */
/* Session cookie                                                      */
/* ------------------------------------------------------------------ */

export const getSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
});

/** Quotes saved from this browser (lib/auth/quote-owner.ts); [] when none. */
export const quoteOwnerGrant = cache(async (): Promise<string[]> => {
  const store = await cookies();
  return readQuoteOwner(store.get(QUOTE_OWNER_COOKIE)?.value);
});

export function staffSession(staff: StaffMember, ttlSeconds?: number): StaffSession {
  return {
    kind: "staff",
    staffId: staff.id,
    email: staff.email,
    name: staff.name,
    roles: staff.roles,
    external: staff.external,
    exp: sessionExpiry(Date.now(), ttlSeconds),
  };
}

export function customerSession(customer: CustomerRecord, projectIds: string[]): CustomerSession {
  return {
    kind: "customer",
    customerId: customer.id,
    email: customer.email,
    name: customer.name ?? "",
    projectIds,
    exp: sessionExpiry(),
  };
}

/** Cookie name, signed value and attributes, for a route handler to set on its own response. */
export async function sessionCookie(session: Session) {
  const options = sessionCookieOptions();
  const maxAge = Math.max(0, session.exp - Math.floor(Date.now() / 1000));
  return { name: SESSION_COOKIE, value: await signSession(session), options: { ...options, maxAge } };
}

/** Sign someone in (server actions and route handlers only: pages can't set cookies). */
export async function setSession(session: Session): Promise<void> {
  const cookie = await sessionCookie(session);
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
}

export async function clearSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

const isAdminEmail = (email: string) => isListedAdmin(email, process.env.ADMIN_EMAILS);

function breakGlassAdmin(email: string): StaffMember {
  return {
    id: BREAK_GLASS_STAFF_ID,
    email,
    name: "Admin (break-glass)",
    roles: ["admin"],
    external: false,
    active: true,
    qualifications: [],
  };
}

/**
 * The live staff record behind a staff session, or null (signed out):
 * missing, inactive, or a break-glass session that no longer qualifies.
 */
async function staffForSession(session: StaffSession): Promise<StaffMember | null> {
  const env = process.env;
  if (session.staffId === BREAK_GLASS_STAFF_ID) {
    // Only while there's nowhere to keep a real admin row: no database, or
    // one without the pilot migration (so the admin can reach /ops/status).
    const ok = breakGlassEnabled(env) && isAdminEmail(session.email) && (!getServiceClient() || (await staffTableMissing()));
    return ok ? breakGlassAdmin(session.email) : null;
  }
  if (!getServiceClient()) {
    // No database: only the fixed DEMO team exists.
    return demoLoginAllowed(env) ? (demoStaffById(session.staffId) ?? null) : null;
  }
  let staff = await staffRepo.get(session.staffId);
  if (!staff && isDemoStaffId(session.staffId) && (await demoModeAllowed(env))) {
    // A demo row lost to a reset (or a memory backend on another instance): recreate it.
    const team = await ensureDemoStaff();
    staff = Object.values(team).find((s) => s.id === session.staffId) ?? null;
  }
  // Demo accounts die with demo mode, and on a database that holds anything real (lib/auth/demo-guard).
  if (staff?.demo && !(await demoModeAllowed(env))) return null;
  return staff && staff.active ? staff : null;
}

/** The signed-in staff member, fresh from the database, or null. */
export const currentStaff = cache(async (): Promise<StaffMember | null> => {
  const session = await getSession();
  if (!session || session.kind !== "staff") return null;
  try {
    return await staffForSession(session);
  } catch (err) {
    console.error("[auth] staff lookup failed:", err);
    return null;
  }
});

/** The path being rendered, as middleware recorded it (for ?next=). */
async function currentPath(fallback: string): Promise<string> {
  const h = await headers();
  return safeNextPath(h.get("x-dih-path"), fallback);
}

/**
 * For pages and server actions. Signed out → /login?next=<this page>.
 * Signed in without the permission (or any of several) → the "no access"
 * page (never the data).
 */
export async function requireStaff(perm?: Permission | readonly Permission[]): Promise<StaffMember> {
  const staff = await currentStaff();
  const gate = decideStaffGate(staff, perm);
  if (gate === "signed-out") {
    redirect(`/login?next=${encodeURIComponent(await currentPath("/ops"))}`);
  }
  if (gate === "forbidden") {
    redirect(`/auth/forbidden?from=${encodeURIComponent(await currentPath("/ops"))}`);
  }
  return staff!;
}

function cookieFromHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * For API routes: the staff member, or a JSON 401 (signed out) / 403
 * (lacking the permission) to return as-is.
 *
 *   const staff = await requireStaffApi(request, "purchasing.edit");
 *   if (staff instanceof Response) return staff;
 */
export async function requireStaffApi(req: Request, perm?: Permission): Promise<StaffMember | Response> {
  const session = await verifySession(cookieFromHeader(req.headers.get("cookie"), SESSION_COOKIE));
  let staff: StaffMember | null = null;
  if (session?.kind === "staff") {
    try {
      staff = await staffForSession(session);
    } catch (err) {
      console.error("[auth] staff lookup failed:", err);
    }
  }
  const gate = decideStaffGate(staff, perm);
  if (gate === "signed-out") return Response.json({ error: "Sign in required" }, { status: 401 });
  if (gate === "forbidden") return Response.json({ error: "You don't have permission to do that" }, { status: 403 });
  return staff!;
}

/**
 * May the signed-in person open this project? Staff: board-wide view, or
 * assigned as surveyor or crew (subcontractors only ever the latter), plus
 * `perm` when given. Customers: only with `allowCustomer`, and only their
 * own projects, or the project made from a quote this browser saved (the
 * funnel's quote-owner cookie). Anything else is null, which callers turn
 * into a 404. `customerSide` marks the customer's own screens (the portal, its
 * money, proposal responses): there staff need `seesCustomerSide` too, so a
 * subcontractor or installer on the job gets the 404.
 */
export async function requireProjectAccess(
  projectId: string,
  opts: { perm?: Permission; allowCustomer?: boolean; customerSide?: boolean } = {},
): Promise<ProjectAccess | null> {
  const session = await getSession();
  const quoteGrant = opts.allowCustomer && session?.kind !== "staff" ? await quoteOwnerGrant() : [];
  if (!session && quoteGrant.length === 0) return null;
  const db = getServiceClient();
  // Not a uuid, not a project (Postgres would refuse the comparison with 22P02, not find nothing).
  if (!db || !isUuid(projectId)) return null;
  const { data: row } = await db.from("projects").select("id, customer_id, quote_id, project").eq("id", projectId).maybeSingle();
  const project = row
    ? {
        ...((row.project ?? {}) as AssignmentView),
        customerId: (row.customer_id as string | null) ?? null,
        quoteId: (row.quote_id as string | null) ?? null,
      }
    : null;
  const staff = session?.kind === "staff" ? await currentStaff() : null;
  return decideProjectAccess({ session, staff, projectId, project, quoteGrant, ...opts });
}

/* ------------------------------------------------------------------ */
/* Sign-in paths                                                       */
/* ------------------------------------------------------------------ */

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The first sign-in from an ADMIN_EMAILS address creates their admin row.
 * An existing row is used as it stands (an admin may have changed it).
 */
async function bootstrapAdmin(email: string, via: string): Promise<StaffMember | null> {
  const existing = await staffRepo.getByEmail(email);
  if (existing) return existing.active ? existing : null;
  if (!isAdminEmail(email)) return null;
  try {
    const created = await staffRepo.insert(
      {
        email: normaliseEmail(email),
        name: nameFromEmail(email),
        roles: ["admin"],
        external: false,
        active: true,
        qualifications: [],
      },
      null, // the system, on the person's own first sign-in
    );
    await audit({ actor: created, action: "staff.bootstrap-admin", entity: "staff", entityId: created.id, detail: { via } });
    return created;
  } catch {
    // Lost a race with a concurrent first sign-in: read the winner.
    const raced = await staffRepo.getByEmail(email);
    return raced?.active ? raced : null;
  }
}

/** The staff member a consumed magic-link token signs in, or null. */
export async function staffForToken(subject: { subjectId: string | null; email: string }): Promise<StaffMember | null> {
  if (subject.subjectId) {
    const staff = await staffRepo.get(subject.subjectId);
    return staff && staff.active ? staff : null;
  }
  return bootstrapAdmin(subject.email, "magic-link");
}

/** sha256 both sides first, so the comparison is constant-time whatever the lengths. */
async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const key = "dih-break-glass";
  return constantTimeEqual(await hmacSha256Hex(key, given), await hmacSha256Hex(key, expected));
}

/**
 * Who a break-glass sign-in for this email would be: an active admin row,
 * an ADMIN_EMAILS address with no row yet (bootstrapped once the password is
 * right), the synthetic admin when there's no database, or nobody. Read-only.
 */
async function breakGlassCandidate(email: string): Promise<StaffMember | "bootstrap" | "synthetic" | null> {
  if (!getServiceClient()) return isAdminEmail(email) ? "synthetic" : null;
  // Supabase is connected but 0010 never ran: there's no staff table to look
  // in or bootstrap into, so an ADMIN_EMAILS address gets the synthetic admin
  // (as with no database), and /ops/status and /ops/launch can say what's wrong.
  if (await staffTableMissing()) return isAdminEmail(email) ? "synthetic" : null;
  const existing = await staffRepo.getByEmail(email);
  if (existing) return existing.active && existing.roles.includes("admin") ? existing : null;
  return isAdminEmail(email) ? "bootstrap" : null;
}

/**
 * Break-glass sign-in: an admin email plus OPS_PASSWORD (only when it's long
 * enough to resist guessing, see `breakGlassEnabled`). Admin means an active
 * admin staff row, or an ADMIN_EMAILS address (bootstrapped on first use).
 * Without a database, ADMIN_EMAILS addresses get a synthetic admin so the
 * legacy demo console still opens. Returns the session to set, or null.
 *
 * The password check and the admin lookup both run on every attempt, and the
 * answer is the same null whichever failed, so neither the time taken nor the
 * reply confirms a right password or a right email on its own.
 */
export async function breakGlassSession(email: string, password: string): Promise<StaffSession | null> {
  if (!breakGlassEnabled(process.env)) return null;
  const clean = normaliseEmail(email);
  const [passwordOk, candidate] = await Promise.all([
    passwordMatches(password, process.env.OPS_PASSWORD ?? ""),
    breakGlassCandidate(clean).catch((err) => {
      console.error("[auth] break-glass lookup failed:", err);
      return null;
    }),
  ]);
  if (!passwordOk || !password || !candidate) return null;
  if (candidate === "synthetic") {
    if (getServiceClient()) console.error(`[auth] break-glass: ${clean} signed in as the synthetic admin because the staff table is missing (run ${PILOT_MIGRATION}).`);
    return staffSession(breakGlassAdmin(clean), BREAK_GLASS_TTL_SECONDS);
  }
  const staff = candidate === "bootstrap" ? await bootstrapAdmin(clean, "break-glass") : candidate;
  if (!staff) return null;
  await audit({ actor: staff, action: "auth.break-glass", entity: "staff", entityId: staff.id });
  return staffSession(staff, BREAK_GLASS_TTL_SECONDS);
}

/**
 * The DEMO team, created on first use (contract §C "Try as…"). Only when
 * demo sign-in is allowed. Existing rows are left as they are, so a demo
 * account's qualifications can be edited to test the gates.
 */
/** The DEMO row still holds one of its DEMO certificates unverified (saved by an older build). */
function demoQualificationsStale(row: StaffMember, demo: StaffMember): boolean {
  return demo.qualifications.some((d) => {
    const held = row.qualifications.find((q) => q.kind === d.kind && q.reference === d.reference);
    return !held || !held.verifiedAt || !held.mediaId;
  });
}

export async function ensureDemoStaff(): Promise<Record<DemoRoleKey, StaffMember>> {
  if (!(await demoModeAllowed())) throw new Error("Demo sign-in is disabled in this environment.");
  if (!getServiceClient()) return DEMO_STAFF;
  const out = {} as Record<DemoRoleKey, StaffMember>;
  for (const [key, demo] of Object.entries(DEMO_STAFF) as [DemoRoleKey, StaffMember][]) {
    let staff = await staffRepo.get(demo.id);
    if (!staff) {
      try {
        staff = await staffRepo.insert(demo, null);
      } catch {
        staff = (await staffRepo.get(demo.id)) ?? (await staffRepo.getByEmail(demo.email));
      }
    } else if (staff.demo && demoQualificationsStale(staff, demo)) {
      // A DEMO row saved before qualifications needed verifying: bring its DEMO certificates up to date.
      staff = await staffRepo.update({ ...staff, qualifications: demo.qualifications }, null).catch(() => staff);
    }
    out[key] = staff ?? demo;
  }
  return out;
}
