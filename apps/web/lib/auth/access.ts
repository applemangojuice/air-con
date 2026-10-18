import { can, type Permission, type StaffMember } from "@aircon/domain";
import type { CustomerSession, Session } from "./session.ts";

/**
 * Access decisions, as pure functions (contract §C). lib/auth/server.ts
 * gathers the facts (session, fresh staff row, project row) and asks these;
 * tests ask them directly. Every "no" is the same `null`, so callers answer
 * 404 and never hint that a record exists.
 */

/** Just enough of a project, v1 or v2, to answer "is this person on the job?". */
export interface AssignmentView {
  survey?: { surveyor?: { staffId?: string } | null } | null;
  booking?: { crew?: { staffId?: string }[] | null } | null;
}

/** Assigned as the surveyor, or on the install crew. */
export function isAssigned(staffId: string, project: AssignmentView | null | undefined): boolean {
  if (!project || !staffId) return false;
  if (project.survey?.surveyor?.staffId === staffId) return true;
  return (project.booking?.crew ?? []).some((m) => m?.staffId === staffId);
}

/**
 * May this staff member open this project? Anyone with the board-wide view
 * may; everyone else (subcontractors, and installers who only see their own
 * jobs) only when they're assigned. A required permission is checked on top.
 */
export function staffCanAccessProject(
  staff: StaffMember,
  project: AssignmentView | null | undefined,
  perm?: Permission,
): boolean {
  if (!staff.active) return false;
  if (perm && !can(staff, perm)) return false;
  return can(staff, "projects.view-all") || isAssigned(staff.id, project);
}

/**
 * May this customer open this project? The project row's customer_id is the
 * authority when it's set (so a re-assigned project drops out of an old
 * session at once); otherwise the session's own project list decides.
 */
export function customerCanAccessProject(
  session: Pick<CustomerSession, "customerId" | "projectIds">,
  projectId: string,
  projectCustomerId: string | null | undefined,
): boolean {
  if (projectCustomerId) return projectCustomerId === session.customerId;
  return session.projectIds.includes(projectId);
}

export type ProjectAccess = { kind: "staff"; staff: StaffMember } | { kind: "customer"; customerId: string };

/**
 * The whole decision for one project. `staff` is the fresh database record
 * for a staff session (null when missing or inactive); `project` is null when
 * the project doesn't exist. `perm` is what staff need; customers hold no
 * permissions, so they get in only when `allowCustomer` says so, and then
 * only to their own projects.
 */
export function decideProjectAccess(input: {
  session: Session | null;
  staff: StaffMember | null;
  projectId: string;
  project: (AssignmentView & { customerId?: string | null }) | null;
  perm?: Permission;
  allowCustomer?: boolean;
}): ProjectAccess | null {
  const { session, staff, project } = input;
  if (!session || !project) return null;
  if (session.kind === "staff") {
    if (!staff || staff.id !== session.staffId) return null;
    return staffCanAccessProject(staff, project, input.perm) ? { kind: "staff", staff } : null;
  }
  if (!input.allowCustomer) return null;
  return customerCanAccessProject(session, input.projectId, project.customerId)
    ? { kind: "customer", customerId: session.customerId }
    : null;
}

/** What a staff-only page or route should do. */
export type StaffGate = "ok" | "signed-out" | "forbidden";

export function decideStaffGate(staff: StaffMember | null, perm?: Permission): StaffGate {
  if (!staff || !staff.active) return "signed-out";
  if (perm && !can(staff, perm)) return "forbidden";
  return "ok";
}

/** Where a staff member lands after signing in, when no `next` was asked for. */
export function staffHome(staff: Pick<StaffMember, "roles" | "external" | "active">): string {
  return can(staff, "projects.view-all") ? "/ops" : "/field";
}

/**
 * Where to send a staff member who just signed in: the `next` they asked
 * for, unless it's somewhere they can never go (subcontractors and the ops
 * console), else their home. Middleware would bounce them anyway, but a
 * server action's redirect can't follow that bounce, so decide up front.
 */
export function staffLanding(
  staff: Pick<StaffMember, "roles" | "external" | "active">,
  next: string | null | undefined,
): string {
  const home = staffHome(staff);
  const target = safeNextPath(next, home);
  const opsConsole = target === "/ops" || target.startsWith("/ops/") || target.startsWith("/ops?") || target.startsWith("/ops#");
  return staff.external && opsConsole ? home : target;
}

/**
 * A same-origin path to redirect to, or the fallback. Rejects absolute and
 * protocol-relative URLs, backslash tricks and control characters, so a
 * sign-in link can't bounce anyone off-site.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    // Resolving against a dummy origin catches anything that would leave it.
    const url = new URL(next, "https://origin.invalid");
    if (url.origin !== "https://origin.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** ADMIN_EMAILS as a normalised list (comma or whitespace separated). */
export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map(normaliseEmail)
    .filter((e) => e.includes("@"));
}

/** Is this one of the ADMIN_EMAILS addresses (bootstrap admins)? */
export function isAdminEmail(email: string, adminEmails: string | undefined): boolean {
  return parseAdminEmails(adminEmails).includes(normaliseEmail(email));
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A plausible email: one @, something either side, a dot in the domain, no spaces. */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** "Try as…" demo sign-in: never in production unless ALLOW_DEMO_LOGIN=1 says so. */
export function demoLoginAllowed(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== "production" || env.ALLOW_DEMO_LOGIN === "1";
}
