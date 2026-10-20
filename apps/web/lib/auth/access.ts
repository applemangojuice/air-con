import { can, type DocumentKind, type DocumentRecord, type Permission, type StaffMember } from "@aircon/domain";
import { MIN_SESSION_SECRET_LENGTH, sessionSecretUsable, type CustomerSession, type Session } from "./session.ts";
import { isPlaceholderValue, placeholderKeys, realEnv } from "../env-placeholders.ts";

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
 * May this customer open this project? Only when the project row's
 * customer_id, read live, is theirs: a re-assigned project, or one detached
 * because staff removed a wrong email (customer_id null), drops out of every
 * session at once. The cookie's project list is a snapshot from sign-in and
 * never grants anything (a project made from a quote this browser saved
 * opens through the quote-owner grant instead).
 */
export function customerCanAccessProject(
  session: Pick<CustomerSession, "customerId" | "projectIds">,
  _projectId: string,
  projectCustomerId: string | null | undefined,
): boolean {
  return Boolean(projectCustomerId) && projectCustomerId === session.customerId;
}

/**
 * `customerId` is the customer record's id; for the browser holding the quote
 * of a project that isn't attached to a customer yet (its unverified funnel
 * email already belonged to someone: createProjectForQuote), it's that
 * quote's `quoteActorId`, which is never a customer record's id.
 */
export type ProjectAccess = { kind: "staff"; staff: StaffMember } | { kind: "customer"; customerId: string };

/**
 * Staff who see the customer's side of a project as the office does: the
 * portal, its prices, the contract, invoices, receipts and drafts. That's the
 * board-wide view, which a subcontractor never holds (EXTERNAL_DENIED), and
 * which installers and the electrician don't have either: the field app shows
 * them the job, never the money (field-server's priced documents use this).
 */
export function seesCustomerSide(staff: Pick<StaffMember, "roles" | "external" | "active">): boolean {
  return staff.active && !staff.external && can(staff, "projects.view-all");
}

/**
 * The customer documents the crew hands over and opens from the field app
 * (the commissioning certificate, the handover pack). Neither carries a price.
 */
export const CREW_DOCUMENT_KINDS: ReadonlySet<DocumentKind> = new Set<DocumentKind>(["commissioning-certificate", "handover-pack"]);

/**
 * May this viewer open this document (/d/[id])? The customer: their issued,
 * customer-visible documents. Staff who see the customer side: everything on
 * the project, drafts included. Anyone else on the job (the crew,
 * subcontractors): only the issued documents the crew hands over, never a
 * proposal, contract, invoice, receipt or variation.
 */
export function mayViewDocument(access: ProjectAccess | null, doc: Pick<DocumentRecord, "kind" | "customerVisible" | "status">): boolean {
  if (!access) return false;
  const issued = doc.customerVisible && doc.status !== "draft";
  if (access.kind === "customer") return issued;
  if (seesCustomerSide(access.staff)) return true;
  return issued && CREW_DOCUMENT_KINDS.has(doc.kind);
}

/** Who acts through a quote-owner grant on a project no customer holds yet. */
export function quoteActorId(quoteId: string): string {
  return `quote:${quoteId.toLowerCase()}`;
}

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
  project: (AssignmentView & { customerId?: string | null; quoteId?: string | null }) | null;
  perm?: Permission;
  allowCustomer?: boolean;
  /**
   * The customer's own screens (/p/**, paying, proposal responses): staff get
   * in only when they see the customer side (`seesCustomerSide`), so a
   * subcontractor or installer on the job is "not found" there, never shown
   * the customer's prices, contract or invoices.
   */
  customerSide?: boolean;
  /**
   * Quotes saved from this browser (lib/auth/quote-owner.ts). Opens the
   * project made from one of them, and nothing else: never the customer
   * record's other projects, since the email behind it is unverified.
   */
  quoteGrant?: readonly string[];
}): ProjectAccess | null {
  const { session, staff, project } = input;
  if (!project) return null;
  if (session?.kind === "staff") {
    if (!staff || staff.id !== session.staffId) return null;
    if (input.customerSide && !seesCustomerSide(staff)) return null;
    return staffCanAccessProject(staff, project, input.perm) ? { kind: "staff", staff } : null;
  }
  if (!input.allowCustomer) return null;
  if (session && customerCanAccessProject(session, input.projectId, project.customerId)) {
    return { kind: "customer", customerId: session.customerId };
  }
  if (project.quoteId && input.quoteGrant?.includes(project.quoteId.toLowerCase())) {
    return { kind: "customer", customerId: project.customerId || quoteActorId(project.quoteId) };
  }
  return null;
}

/** What a staff-only page or route should do. */
export type StaffGate = "ok" | "signed-out" | "forbidden";

/** `perm` may be several permissions, all of which are needed. */
export function decideStaffGate(staff: StaffMember | null, perm?: Permission | readonly Permission[]): StaffGate {
  if (!staff || !staff.active) return "signed-out";
  const needed: readonly Permission[] = perm === undefined ? [] : typeof perm === "string" ? [perm] : perm;
  if (needed.some((p) => !can(staff, p))) return "forbidden";
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

/** Why a sign-in link didn't sign anyone in. */
export type DeadLinkReason = "expired" | "missing" | "unavailable";

/**
 * Where a sign-in link that can't be used (expired, already used, cut
 * short, or the database is down) sends someone. Customers never land on
 * the staff sign-in page:
 *  * still signed in as the link's own subject: wherever the link was going
 *    (a customer reopening yesterday's "Review your proposal" email lands on
 *    the proposal); signed in as anyone else: their own home;
 *  * signed out: a customer page that says the link has expired and offers
 *    a fresh one (/portal?link=…), or for a staff link, the team sign-in.
 * `token` is what we know of the dead link (its kind, subject and `next`),
 * null when it's unknown or there was none.
 */
export function deadLinkLanding(input: {
  token: { kind: "staff" | "customer"; subjectId: string | null; email: string; next?: string } | null;
  session: Session | null;
  reason: DeadLinkReason;
}): string {
  const { token, session, reason } = input;
  const own =
    token && session && token.kind === session.kind
      ? token.subjectId
        ? token.subjectId === (session.kind === "staff" ? session.staffId : session.customerId)
        : sameEmail(token.email, session.email)
      : false;
  if (session?.kind === "customer") {
    const home = session.projectIds.length === 1 ? `/p/${session.projectIds[0]}` : "/portal";
    return own ? safeNextPath(token?.next, home) : home;
  }
  if (session?.kind === "staff" && token?.kind !== "customer") {
    return staffLanding({ roles: session.roles, external: session.external, active: true }, own ? token?.next : null);
  }
  return token?.kind === "staff" ? `/login?error=${reason}` : `/portal?link=${reason}`;
}

/**
 * A same-origin path to redirect to, or the fallback. Rejects absolute and
 * protocol-relative URLs, backslash tricks and control characters, so a
 * sign-in link can't bounce anyone off-site. The checks run again on the
 * normalised result: dot segments can turn a harmless-looking path into a
 * protocol-relative one (`/.//evil.com` → `//evil.com`), which a browser,
 * or `new URL(target, request.url)`, would send off-site.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!isSafeRelative(next)) return fallback;
  try {
    // Resolving against a dummy origin catches anything that would leave it.
    const url = new URL(next, "https://origin.invalid");
    if (url.origin !== "https://origin.invalid") return fallback;
    const out = `${url.pathname}${url.search}${url.hash}`;
    return isSafeRelative(out) ? out : fallback;
  } catch {
    return fallback;
  }
}

function isSafeRelative(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return false;
  return !/[\u0000-\u001f\u007f\\]/.test(path);
}

/** ADMIN_EMAILS as a normalised list (comma or whitespace separated). */
export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map(normaliseEmail)
    // A template address (you@example.com) is nobody's: it never makes an admin.
    .filter((e) => e.includes("@") && !isPlaceholderValue(e));
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

/**
 * "Try as…" demo sign-in: never in production unless ALLOW_DEMO_LOGIN=1 says
 * so, and never against a production Supabase database unless
 * DEMO_DEPLOYMENT=1 says that database is a demo one too. A demo admin holds
 * every permission, so on a real database it would hand anyone on the
 * internet the customers' records.
 */
export function demoLoginAllowed(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV !== "production") return true;
  if (env.ALLOW_DEMO_LOGIN !== "1") return false;
  const supabase = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  return !supabase || env.DEMO_DEPLOYMENT === "1";
}

/**
 * What a Supabase database holds that no demo put there (lib/auth/demo-guard.ts
 * looks): quotes that aren't the demo seed's, customers, and staff who aren't
 * DEMO accounts, each on an address a real person could own (not a reserved
 * one: isReservedDemoAddress). Any one of them is real people's data.
 */
export interface RealRecords {
  quotes: number;
  customers: number;
  staff: number;
}

/**
 * Demo sign-in, the demo seed and the demo-mode fallbacks (simulated card
 * payments, demo-stored emails counting as sent), with what the database
 * actually holds taken into account. The env flags first (demoLoginAllowed);
 * then, on a Supabase database, only while it holds nothing real. Flags are a
 * claim (DEMO_DEPLOYMENT=1 copied onto the live business, or a laptop's dev
 * server pointed at the live database): this checks it, so a demo admin can
 * never open a real customer's record. `records` is null when the database
 * couldn't be asked, which is a no.
 */
export function demoAllowedWithData(
  env: Record<string, string | undefined>,
  backend: string,
  records: RealRecords | null,
): boolean {
  if (!demoLoginAllowed(env)) return false;
  if (backend !== "supabase") return true;
  return records !== null && records.quotes === 0 && records.customers === 0 && records.staff === 0;
}

/** "real quotes and customers" for the logs and /ops/launch; "" when there are none. */
export function describeRealRecords(records: RealRecords): string {
  const found = [records.quotes > 0 && "quotes", records.customers > 0 && "customers", records.staff > 0 && "team members"].filter(
    (x): x is string => Boolean(x),
  );
  if (!found.length) return "";
  const list = found.length === 1 ? found[0]! : `${found.slice(0, -1).join(", ")} and ${found[found.length - 1]}`;
  return `real ${list}`;
}

/** ALLOW_DEMO_LOGIN=1 set in production, but refused because the database is real (for the boot warning). */
export function demoLoginRefusedOnRealData(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === "production" && env.ALLOW_DEMO_LOGIN === "1" && !demoLoginAllowed(env);
}

/**
 * A staff record written by a demo session is itself demo: it dies with demo
 * mode (staffForSession refuses demo rows once demo sign-in is off), so
 * nothing a "Try as… Admin" visitor creates outlives the demo.
 */
export function taintedByDemo<T extends { demo?: boolean }>(record: T, by: { demo?: boolean } | null | undefined): T {
  return by?.demo ? { ...record, demo: true } : record;
}

/** Break-glass passwords shorter than this are refused outright: it's one shared secret guarding admin. */
export const MIN_BREAK_GLASS_PASSWORD = 20;

/**
 * The brakes on break-glass guessing, for one attempt from `ip` (IPv6 by its
 * /64) with `email`. Every key is scoped to the caller's own network, so a
 * flood of junk attempts only ever locks out the network sending it, never a
 * founder signing in from anywhere else: break-glass is the way in on launch
 * day, while the email domain verifies. There's deliberately no count shared
 * across networks (it was 20 an hour for everyone, and 5 an hour per address):
 * anyone could fill one with a few unauthenticated posts and keep every admin
 * out. Guessing from many networks is bounded by the password itself: 20+
 * characters, template values refused (`breakGlassEnabled`), every failure
 * audited.
 */
export function breakGlassLimits(ip: string, email: string): { key: string; limit: number; windowMs: number }[] {
  return [
    { key: `break-glass:${ip}`, limit: 5, windowMs: 15 * 60_000 },
    { key: `break-glass-email:${email}|${ip}`, limit: 5, windowMs: 60 * 60_000 },
  ];
}

/** Is break-glass sign-in on? Only with an OPS_PASSWORD long enough to resist guessing. */
export function breakGlassEnabled(env: Record<string, string | undefined>): boolean {
  // The .env.example placeholder is published in the repo: never a password.
  if (isPlaceholderValue(env.OPS_PASSWORD)) return false;
  return (env.OPS_PASSWORD ?? "").length >= MIN_BREAK_GLASS_PASSWORD;
}

/**
 * Sign-in configuration that's unsafe or silently off, said loudly at boot
 * (instrumentation.ts) so it's in the deployment logs, not discovered later.
 */
export function securityWarnings(env: Record<string, string | undefined>): string[] {
  if (env.NODE_ENV !== "production") return [];
  const out: string[] = [];
  if (demoLoginRefusedOnRealData(env)) {
    out.push(
      "ALLOW_DEMO_LOGIN=1 is set on a Supabase database, so demo sign-in is REFUSED. Set DEMO_DEPLOYMENT=1 only if that database holds nothing real.",
    );
  } else if (demoLoginAllowed(env)) {
    out.push(
      "DEMO sign-in is ON in production: anyone can sign in as a demo admin. Only for a deployment with nothing real in it (it refuses itself on a database that holds a real quote, customer or team member).",
    );
  }
  if (!sessionSecretUsable(env)) {
    out.push(
      isPlaceholderValue(env.SESSION_SECRET)
        ? "SESSION_SECRET is still the .env.example placeholder (a value anyone can read in the repo), so it's ignored and nobody can sign in. Use: openssl rand -hex 32"
        : env.SESSION_SECRET
          ? `SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_LENGTH} characters, so it's ignored and nobody can sign in. Use: openssl rand -hex 32`
          : "SESSION_SECRET is not set, so nobody can sign in. Use: openssl rand -hex 32",
    );
  }
  if (isPlaceholderValue(env.OPS_PASSWORD)) {
    out.push("OPS_PASSWORD is still the .env.example placeholder, so break-glass sign-in is off. Use: openssl rand -base64 24, or unset it.");
  } else if (env.OPS_PASSWORD && !breakGlassEnabled(env)) {
    out.push(`OPS_PASSWORD is shorter than ${MIN_BREAK_GLASS_PASSWORD} characters, so break-glass sign-in is off.`);
  }
  const others = placeholderKeys(env).filter((k) => k !== "SESSION_SECRET" && k !== "OPS_PASSWORD");
  if (others.length) {
    out.push(`${others.join(", ")} still hold .env.example placeholder values, so they count as not set (the matching features stay off or in demo mode). Set real values or remove them.`);
  }
  if (!realEnv(env, "CRON_SECRET")) {
    out.push("CRON_SECRET is not set: the daily jobs (survey and day-before reminders, proposal expiry, outbox retries, aftercare) and the morning digest all refuse to run.");
  }
  return out;
}

/** The same mailbox, however it was typed. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normaliseEmail(a ?? "");
  return x.length > 0 && x === normaliseEmail(b ?? "");
}

/**
 * May a sign-in link for this customer go to this address? Only to the
 * customer's own email: a token signs in as the customer record, so a link
 * sent anywhere else would hand that address the customer's whole account.
 */
export function linkMayCarryToken(customerEmail: string | null | undefined, recipient: string | null | undefined): boolean {
  return sameEmail(customerEmail, recipient) && isPlausibleEmail(normaliseEmail(recipient ?? ""));
}

/**
 * When a project's email changes, the address the project should now belong
 * to (normalised), else null. The email is the customer's identity, so a new
 * address means a different customer record; clearing the email leaves the
 * project where it is (nothing is sent to anyone until a new address is set).
 */
export function relinkEmail(before: string | null | undefined, after: string | null | undefined): string | null {
  const next = normaliseEmail(after ?? "");
  if (!next || !isPlausibleEmail(next) || sameEmail(before, next)) return null;
  return next;
}

/**
 * An address that can never belong to a real person: the reserved example
 * domains (RFC 2606 / 6761: example.com, .org, .net and anything under
 * .example, .invalid, .test). DEMO households and the DEMO team use them.
 */
export function isReservedDemoAddress(email: string | null | undefined): boolean {
  const clean = normaliseEmail(email ?? "");
  const at = clean.lastIndexOf("@");
  if (at < 1 || !isPlausibleEmail(clean)) return false;
  const domain = clean.slice(at + 1).replace(/\.$/, "");
  if (["example.com", "example.org", "example.net"].some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return /\.(example|invalid|test)$/.test(domain);
}

/**
 * May a sign-in link be shown on screen instead of emailed? Only where no
 * email provider is set up, and then only on a developer's machine, or on a
 * demo deployment (demo sign-in allowed) for a DEMO account or a reserved
 * address that no real person can own. Showing a real person's link would
 * let anyone sign in as them.
 */
export function linkMayShowOnScreen(input: {
  env: Record<string, string | undefined>;
  emailLive: boolean;
  email: string;
  demoAccount: boolean;
}): boolean {
  if (input.emailLive) return false;
  if (input.env.NODE_ENV !== "production") return true;
  return demoLoginAllowed(input.env) && (input.demoAccount || isReservedDemoAddress(input.email));
}

/** "jo.bloggs@example.com" → "j***@example.com", for confirming who a link is for without revealing it. */
export function maskEmail(email: string): string {
  const clean = normaliseEmail(email);
  const at = clean.lastIndexOf("@");
  if (at < 1) return "***";
  return `${clean[0]}***${clean.slice(at)}`;
}

/* ------------------------------------------------------------------ */
/* Sign-in codes                                                       */
/* ------------------------------------------------------------------ */

/**
 * Every sign-in email carries a 6-digit code beside its link (§K45), so
 * someone whose email app opens links in its own browser, or who uses the
 * Home Screen web app (its own cookie jar), can sign in where they choose by
 * typing it. A mail scanner can't: the link's page needs a tap, and the code
 * needs typing into our page.
 */
export const SIGN_IN_CODE_DIGITS = 6;
/** A code lasts as long as its link, or this, whichever is shorter. */
export const SIGN_IN_CODE_MAX_MINUTES = 15;

/** How long a sign-in email's code works, for a link that lasts `linkMinutes`. */
export function signInCodeMinutes(linkMinutes: number): number {
  return Math.max(1, Math.min(SIGN_IN_CODE_MAX_MINUTES, Math.floor(linkMinutes)));
}

/** The code as typed: spaces and dashes dropped. Null unless exactly six digits remain. */
export function normaliseSignInCode(raw: string | null | undefined): string | null {
  const clean = String(raw ?? "").replace(/[\s-]+/g, "");
  return /^\d{6}$/.test(clean) ? clean : null;
}

/** "123456" → "123 456", the way the email prints it (easier to read off one screen and type on another). */
export function formatSignInCode(code: string): string {
  return code.length === SIGN_IN_CODE_DIGITS ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/**
 * The brakes on typing codes, all counted in the database (rate-limit-shared):
 * per address (and kind) and per network, a quarter hour and a day. Only the
 * newest code for an address is ever accepted, so each guess is one in a
 * million, and these keep a whole day's guesses against one inbox to 10.
 * Someone hammering an address only blocks its codes: the link still works.
 */
export function signInCodeLimits(ip: string, kind: "staff" | "customer", email: string): { key: string; limit: number; windowMs: number }[] {
  const who = `${kind}:${normaliseEmail(email)}`;
  return [
    { key: `code-email:${who}`, limit: 5, windowMs: 15 * 60_000 },
    { key: `code-email-day:${who}`, limit: 10, windowMs: 24 * 60 * 60_000 },
    { key: `code-ip:${ip}`, limit: 10, windowMs: 15 * 60_000 },
    { key: `code-ip-day:${ip}`, limit: 40, windowMs: 24 * 60 * 60_000 },
  ];
}

/**
 * Did this POST come from our own pages? Cross-site posts to a sign-in
 * endpoint could sign a visitor into someone else's account (login CSRF), so
 * /auth/verify and /auth/code refuse them. A missing Origin is allowed (very
 * old browsers omit it on same-origin form posts); "null" (sandboxed frames)
 * is not.
 */
export function isSameOrigin(origin: string | null, host: string): boolean {
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
