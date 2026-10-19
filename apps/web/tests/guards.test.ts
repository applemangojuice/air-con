import { test } from "node:test";
import assert from "node:assert/strict";
import { can, meetsRequirement, type StaffMember } from "@aircon/domain";
import {
  MIN_BREAK_GLASS_PASSWORD,
  breakGlassEnabled,
  customerCanAccessProject,
  deadLinkLanding,
  decideProjectAccess,
  decideStaffGate,
  demoLoginAllowed,
  demoLoginRefusedOnRealData,
  isAdminEmail,
  isAssigned,
  isPlausibleEmail,
  isReservedDemoAddress,
  linkMayCarryToken,
  mayViewDocument,
  linkMayShowOnScreen,
  maskEmail,
  parseAdminEmails,
  relinkEmail,
  safeNextPath,
  sameEmail,
  securityWarnings,
  seesCustomerSide,
  taintedByDemo,
  staffCanAccessProject,
  staffHome,
  staffLanding,
} from "../lib/auth/access.ts";
import { DEMO_ROLE_KEYS, DEMO_STAFF, isDemoRoleKey, isDemoStaffId } from "../lib/auth/demo-staff.ts";
import type { CustomerSession, StaffSession } from "../lib/auth/session.ts";
import { cronSecret, isPlaceholderValue, placeholderKeys } from "../lib/env-placeholders.ts";
import { stripeMode } from "../lib/providers/stripe.ts";

/** DEMO people only. */
const person = (id: string, over: Partial<StaffMember> = {}): StaffMember => ({
  id,
  email: `${id}@demo.dang.invalid`,
  name: `DEMO ${id}`,
  roles: ["installer"],
  external: false,
  active: true,
  qualifications: [],
  ...over,
});

const admin = person("admin", { roles: ["admin"] });
const surveyor = person("surveyor", { roles: ["surveyor"] });
const installer = person("installer");
const sub = person("sub", { external: true });
const subSurveyor = person("sub-surveyor", { roles: ["surveyor"], external: true });
const leaver = person("leaver", { roles: ["admin"], active: false });

const PROJECT_ID = "p-1";
const project = {
  survey: { surveyor: { staffId: "sub-surveyor" } },
  booking: { crew: [{ staffId: "sub" }, { staffId: "installer" }] },
  customerId: "cust-1",
};
const otherProject = { survey: {}, booking: { crew: [{ staffId: "someone-else" }] }, customerId: "cust-2" };

const staffSessionFor = (s: StaffMember): StaffSession => ({
  kind: "staff",
  staffId: s.id,
  email: s.email,
  name: s.name,
  roles: s.roles,
  external: s.external,
  exp: 9_999_999_999,
});

const customer: CustomerSession = {
  kind: "customer",
  customerId: "cust-1",
  email: "demo.customer@demo.dang.invalid",
  name: "DEMO Alex",
  projectIds: [PROJECT_ID],
  exp: 9_999_999_999,
};

test("assignment: surveyor or crew, on v2 shapes; v1 shapes (no staff ids) never match", () => {
  assert.equal(isAssigned("sub-surveyor", project), true);
  assert.equal(isAssigned("sub", project), true);
  assert.equal(isAssigned("admin", project), false);
  assert.equal(isAssigned("sub", { siteVisit: {}, installation: { installer: { name: "x" } } } as never), false);
  assert.equal(isAssigned("sub", null), false);
  assert.equal(isAssigned("", project), false);
});

test("staff project access: board-wide view sees all; everyone else only their jobs", () => {
  assert.equal(staffCanAccessProject(admin, otherProject), true);
  assert.equal(staffCanAccessProject(surveyor, otherProject), true, "internal surveyors see the board");

  assert.equal(staffCanAccessProject(sub, project), true, "subcontractor on the crew");
  assert.equal(staffCanAccessProject(sub, otherProject), false, "subcontractor, not on the job");
  assert.equal(staffCanAccessProject(subSurveyor, project), true, "external surveyor assigned");
  assert.equal(staffCanAccessProject(subSurveyor, otherProject), false, "external surveyor, not assigned");
  assert.equal(staffCanAccessProject(installer, otherProject), false, "installers see their own jobs");

  assert.equal(staffCanAccessProject(leaver, project), false, "inactive staff see nothing");
});

test("staff project access: a required permission is checked on top of assignment", () => {
  assert.equal(staffCanAccessProject(sub, project, "install.work"), true);
  assert.equal(staffCanAccessProject(sub, project, "finance.view-margin"), false, "subcontractors never see margin");
  assert.equal(staffCanAccessProject(installer, project, "proposal.issue"), false);
  assert.equal(staffCanAccessProject(admin, otherProject, "finance.view-margin"), true);
  assert.equal(can(subSurveyor, "projects.view-all"), false, "external drops the board-wide view");
});

test("customer access: the project's customer_id is the authority; else the session list", () => {
  assert.equal(customerCanAccessProject(customer, PROJECT_ID, "cust-1"), true);
  assert.equal(customerCanAccessProject(customer, PROJECT_ID, "cust-2"), false, "re-assigned: listed but not theirs");
  assert.equal(customerCanAccessProject(customer, "p-new", "cust-1"), true, "fresh grant via the row");
  assert.equal(customerCanAccessProject(customer, PROJECT_ID, null), true, "row unset: session list decides");
  assert.equal(customerCanAccessProject(customer, "p-other", null), false);
});

test("decideProjectAccess: one null for every kind of no", () => {
  const base = { projectId: PROJECT_ID, project };
  assert.equal(decideProjectAccess({ ...base, session: null, staff: null }), null, "signed out");
  assert.equal(decideProjectAccess({ ...base, project: null, session: staffSessionFor(admin), staff: admin }), null, "no such project");
  assert.equal(decideProjectAccess({ ...base, session: staffSessionFor(leaver), staff: null }), null, "inactive or deleted");
  assert.equal(
    decideProjectAccess({ ...base, session: staffSessionFor(admin), staff: installer }),
    null,
    "session and record disagree",
  );

  assert.deepEqual(decideProjectAccess({ ...base, session: staffSessionFor(sub), staff: sub }), { kind: "staff", staff: sub });
  assert.equal(
    decideProjectAccess({ ...base, project: otherProject, session: staffSessionFor(sub), staff: sub }),
    null,
    "subcontractor, someone else's job",
  );

  assert.equal(decideProjectAccess({ ...base, session: customer, staff: null }), null, "customers need allowCustomer");
  assert.deepEqual(decideProjectAccess({ ...base, session: customer, staff: null, allowCustomer: true }), {
    kind: "customer",
    customerId: "cust-1",
  });
  assert.equal(
    decideProjectAccess({ ...base, project: otherProject, session: customer, staff: null, allowCustomer: true }),
    null,
    "customer A can't open customer B's project",
  );
  assert.deepEqual(
    decideProjectAccess({ ...base, session: customer, staff: null, allowCustomer: true, perm: "projects.edit" }),
    { kind: "customer", customerId: "cust-1" },
    "perm is the staff requirement; allowCustomer lets the owner in",
  );
});

test("the customer's own screens: subcontractors and installers on the job are 'not found', never shown prices", () => {
  const base = { projectId: PROJECT_ID, project, allowCustomer: true, customerSide: true };
  assert.equal(seesCustomerSide(admin), true);
  assert.equal(seesCustomerSide(surveyor), true, "the office's surveyor sees the board and the customer side");
  assert.equal(seesCustomerSide(sub), false, "a subcontractor never");
  assert.equal(seesCustomerSide(subSurveyor), false, "nor an external surveyor");
  assert.equal(seesCustomerSide(installer), false, "an installer sees the job, not the money");
  assert.equal(seesCustomerSide(leaver), false);
  // The subcontractor is on this job's crew: the field app opens it, the customer's screens don't.
  assert.deepEqual(decideProjectAccess({ projectId: PROJECT_ID, project, session: staffSessionFor(sub), staff: sub, allowCustomer: true }), { kind: "staff", staff: sub });
  assert.equal(decideProjectAccess({ ...base, session: staffSessionFor(sub), staff: sub }), null, "subcontractor on the crew: /p, /pay, /proposal, /documents are 404");
  assert.equal(decideProjectAccess({ ...base, session: staffSessionFor(installer), staff: installer }), null, "installer on the crew: the same");
  assert.equal(decideProjectAccess({ ...base, session: staffSessionFor(subSurveyor), staff: subSurveyor }), null, "external surveyor on the job: the same");
  assert.deepEqual(decideProjectAccess({ ...base, session: staffSessionFor(admin), staff: admin }), { kind: "staff", staff: admin }, "the office's preview stays");
  assert.deepEqual(decideProjectAccess({ ...base, session: customer, staff: null }), { kind: "customer", customerId: "cust-1" }, "the customer, of course");
});

test("documents: the crew opens only what it hands over; the customer only what's issued to them", () => {
  const doc = (kind: Parameters<typeof mayViewDocument>[1]["kind"], over: { customerVisible?: boolean; status?: "draft" | "final" | "superseded" } = {}) => ({
    kind,
    customerVisible: over.customerVisible ?? true,
    status: over.status ?? ("final" as const),
  });
  const subAccess = { kind: "staff" as const, staff: sub };
  const installerAccess = { kind: "staff" as const, staff: installer };
  const office = { kind: "staff" as const, staff: admin };
  const cust = { kind: "customer" as const, customerId: "cust-1" };
  for (const kind of ["proposal", "contract", "invoice", "receipt", "variation", "survey-report", "certificate"] as const) {
    assert.equal(mayViewDocument(subAccess, doc(kind)), false, `subcontractor: no ${kind}`);
    assert.equal(mayViewDocument(installerAccess, doc(kind)), false, `installer: no ${kind}`);
    assert.equal(mayViewDocument(office, doc(kind)), true, `office: ${kind}`);
    assert.equal(mayViewDocument(cust, doc(kind)), true, `customer: their ${kind}`);
  }
  assert.equal(mayViewDocument(subAccess, doc("handover-pack")), true, "the crew opens the handover pack it published");
  assert.equal(mayViewDocument(installerAccess, doc("commissioning-certificate")), true);
  assert.equal(mayViewDocument(subAccess, doc("handover-pack", { status: "draft" })), false, "never a draft");
  assert.equal(mayViewDocument(subAccess, doc("handover-pack", { customerVisible: false })), false);
  assert.equal(mayViewDocument(office, doc("contract", { status: "draft", customerVisible: false })), true, "the office sees drafts");
  assert.equal(mayViewDocument(cust, doc("invoice", { status: "draft" })), false, "the customer never a draft");
  assert.equal(mayViewDocument(null, doc("handover-pack")), false);
});

test("decideProjectAccess: a quote-owner grant opens only the project made from that quote", () => {
  const QUOTE = "11111111-2222-4333-8444-555555555555";
  const fromQuote = { ...project, customerId: "cust-9", quoteId: QUOTE };
  const base = { projectId: PROJECT_ID, staff: null, allowCustomer: true };
  assert.deepEqual(
    decideProjectAccess({ ...base, session: null, project: fromQuote, quoteGrant: [QUOTE] }),
    { kind: "customer", customerId: "cust-9" },
    "the browser that saved the quote opens its project",
  );
  assert.equal(decideProjectAccess({ ...base, session: null, project: fromQuote, quoteGrant: [] }), null, "no grant");
  assert.equal(
    decideProjectAccess({ ...base, session: null, project: { ...fromQuote, quoteId: "99999999-2222-4333-8444-555555555555" }, quoteGrant: [QUOTE] }),
    null,
    "another quote's project, even for the same customer record",
  );
  assert.equal(
    decideProjectAccess({ ...base, allowCustomer: false, session: null, project: fromQuote, quoteGrant: [QUOTE] }),
    null,
    "customer-facing routes only",
  );
  assert.deepEqual(
    decideProjectAccess({ ...base, session: null, project: { ...fromQuote, customerId: null }, quoteGrant: [QUOTE] }),
    { kind: "customer", customerId: `quote:${QUOTE}` },
    "not attached to a customer yet (their email was someone else's): the browser acts as its quote, never as a customer record",
  );
  assert.equal(
    decideProjectAccess({ ...base, session: { ...customer, customerId: "cust-9", projectIds: [] }, project: { ...fromQuote, customerId: null }, quoteGrant: [] }),
    null,
    "an unattached project isn't the signed-in customer's just because the email matches",
  );
  assert.equal(
    decideProjectAccess({ ...base, session: staffSessionFor(sub), staff: sub, project: { ...otherProject, quoteId: QUOTE }, quoteGrant: [QUOTE] }),
    null,
    "a staff session is judged as staff",
  );
});

test("decideStaffGate: signed out, forbidden or ok", () => {
  assert.equal(decideStaffGate(null), "signed-out");
  assert.equal(decideStaffGate(leaver), "signed-out", "inactive is signed out");
  assert.equal(decideStaffGate(installer), "ok");
  assert.equal(decideStaffGate(installer, "settings.edit"), "forbidden");
  assert.equal(decideStaffGate(admin, "settings.edit"), "ok");
  assert.equal(decideStaffGate(person("lead", { roles: ["tech-lead"] }), "staff.edit"), "forbidden");
  // Several permissions: all of them are needed.
  assert.equal(decideStaffGate(admin, ["projects.edit", "projects.view-all"]), "ok");
  assert.equal(decideStaffGate(installer, ["install.work", "projects.view-all"]), "forbidden");
  assert.equal(decideStaffGate(person("sub", { roles: ["surveyor"], external: true }), ["projects.edit", "projects.view-all"]), "forbidden");
});

test("staffHome: the board for board-wide roles, the field app for everyone else", () => {
  assert.equal(staffHome(admin), "/ops");
  assert.equal(staffHome(surveyor), "/ops");
  assert.equal(staffHome(installer), "/field");
  assert.equal(staffHome(sub), "/field");
});

test("staffLanding: next when it's somewhere they can go, else home", () => {
  assert.equal(staffLanding(admin, "/ops/projects/abc"), "/ops/projects/abc");
  assert.equal(staffLanding(admin, ""), "/ops");
  assert.equal(staffLanding(installer, null), "/field");
  assert.equal(staffLanding(sub, "/ops/quotes"), "/field", "subcontractors never land in the ops console");
  assert.equal(staffLanding(sub, "/ops"), "/field");
  assert.equal(staffLanding(sub, "/field/jobs/1"), "/field/jobs/1");
  assert.equal(staffLanding(sub, "/opsy"), "/opsy", "only the ops console itself");
  assert.equal(staffLanding(admin, "https://evil.example"), "/ops");
});

test("safeNextPath: same-origin paths only", () => {
  const F = "/fallback";
  assert.equal(safeNextPath("/ops/projects/abc?tab=kit#money", F), "/ops/projects/abc?tab=kit#money");
  assert.equal(safeNextPath("/p/123#survey", F), "/p/123#survey");
  assert.equal(safeNextPath("/ops/../field", F), "/field", "normalised");
  for (const bad of [
    undefined,
    null,
    "",
    "ops",
    "https://evil.example",
    "//evil.example",
    "//evil.example/ops",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/ops\nSet-Cookie: x=1",
    "/ops\tx",
    `/${"a".repeat(3000)}`,
    // Dot segments that normalise into a protocol-relative URL.
    "/.//evil.com",
    "/%2e//evil.com",
    "/%2E%2E//evil.com",
    "/a/..//evil.com",
    "/ops/..//evil.com",
    "/ops/../..//evil.com/x?y=1",
  ]) {
    assert.equal(safeNextPath(bad as string | null | undefined, F), F, JSON.stringify(bad));
  }
  // What a redirect would actually resolve to stays on our origin.
  for (const tricky of ["/.//evil.com", "/%2e//evil.com", "/a/..//evil.com", "/ops/..//evil.com"]) {
    assert.equal(new URL(safeNextPath(tricky, "/login"), "https://dang.example/auth/logout").host, "dang.example", tricky);
  }
  assert.equal(safeNextPath("/./ops", F), "/ops", "harmless dot segments still normalise");
});

test("ADMIN_EMAILS: comma or space separated, case-insensitive", () => {
  assert.deepEqual(parseAdminEmails(" Owner@Example.com, second@example.com;third@example.com  nope "), [
    "owner@example.com",
    "second@example.com",
    "third@example.com",
  ]);
  assert.deepEqual(parseAdminEmails(undefined), []);
  assert.equal(isAdminEmail("OWNER@example.com ", "owner@example.com"), true);
  assert.equal(isAdminEmail("intruder@example.com", "owner@example.com"), false);
  assert.equal(isAdminEmail("owner@example.com", undefined), false);
});

test("demo sign-in: outside production, or production with ALLOW_DEMO_LOGIN=1 on demo data", () => {
  assert.equal(demoLoginAllowed({ NODE_ENV: "development" }), true);
  assert.equal(demoLoginAllowed({ NODE_ENV: "test" }), true);
  assert.equal(demoLoginAllowed({ NODE_ENV: "production" }), false);
  assert.equal(demoLoginAllowed({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1" }), true);
  assert.equal(demoLoginAllowed({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "true" }), false, "exactly 1");
  // A real Supabase database needs the second, explicit flag.
  const real = { NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
  assert.equal(demoLoginAllowed(real), false);
  assert.equal(demoLoginRefusedOnRealData(real), true);
  assert.equal(demoLoginAllowed({ ...real, DEMO_DEPLOYMENT: "1" }), true);
  assert.equal(demoLoginRefusedOnRealData({ ...real, DEMO_DEPLOYMENT: "1" }), false);
  assert.equal(demoLoginAllowed({ ...real, DEMO_DEPLOYMENT: "yes" }), false, "exactly 1");
  assert.equal(demoLoginAllowed({ ...real, NODE_ENV: "development" }), true, "dev is always demo-able");
  assert.equal(demoLoginRefusedOnRealData({ NODE_ENV: "production" }), false);
});

test("reserved demo addresses: example domains and .example/.invalid/.test only", () => {
  for (const ok of ["demo.pat@example.com", "A@EXAMPLE.ORG", "x@mail.example.net", "x@demo.dang.invalid", "x@shop.test", "x@foo.example"]) {
    assert.equal(isReservedDemoAddress(ok), true, ok);
  }
  for (const no of ["pat@gmail.com", "x@example.co.uk", "x@notexample.com", "x@example.com.evil.io", "x@testing.io", "", null, "example.com"]) {
    assert.equal(isReservedDemoAddress(no), false, String(no));
  }
});

test("on-screen sign-in links: dev, or a demo deployment for DEMO accounts and reserved addresses; never with email live", () => {
  const demoProd = { NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1" };
  const base = { emailLive: false, demoAccount: false };
  assert.equal(linkMayShowOnScreen({ ...base, env: { NODE_ENV: "development" }, email: "pat@gmail.com" }), true);
  assert.equal(linkMayShowOnScreen({ ...base, env: { NODE_ENV: "development" }, email: "pat@gmail.com", emailLive: true }), false);
  assert.equal(linkMayShowOnScreen({ ...base, env: demoProd, email: "demo.pat@example.com" }), true, "DEMO household");
  assert.equal(linkMayShowOnScreen({ ...base, env: demoProd, email: "x@demo.dang.invalid", demoAccount: true }), true, "DEMO team");
  assert.equal(linkMayShowOnScreen({ ...base, env: demoProd, email: "pat@gmail.com" }), false, "a real person's link never shows");
  assert.equal(linkMayShowOnScreen({ ...base, env: { NODE_ENV: "production" }, email: "demo.pat@example.com" }), false, "not a demo deployment");
  const realDb = { ...demoProd, SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };
  assert.equal(linkMayShowOnScreen({ ...base, env: realDb, email: "demo.pat@example.com" }), false, "demo refused on real data");
});

test("a staff record written by a demo session is demo too", () => {
  const record = { email: "new.admin@example.test", roles: ["admin"], demo: false };
  assert.equal(taintedByDemo(record, { demo: true }).demo, true);
  assert.equal(taintedByDemo(record, { demo: false }).demo, false);
  assert.equal(taintedByDemo(record, null).demo, false);
  assert.equal(record.demo, false, "never mutates");
});

test("break-glass needs a long OPS_PASSWORD", () => {
  assert.equal(MIN_BREAK_GLASS_PASSWORD, 20);
  assert.equal(breakGlassEnabled({}), false);
  assert.equal(breakGlassEnabled({ OPS_PASSWORD: "" }), false);
  assert.equal(breakGlassEnabled({ OPS_PASSWORD: "hunter2" }), false);
  assert.equal(breakGlassEnabled({ OPS_PASSWORD: "p4".repeat(10).slice(0, 19) }), false);
  assert.equal(breakGlassEnabled({ OPS_PASSWORD: "p4".repeat(10) }), true);
  // The .env.example placeholder (33 characters, in the public repo) never turns it on.
  assert.equal(breakGlassEnabled({ OPS_PASSWORD: "at-least-twenty-random-characters" }), false);
  // Nor main's original template (21 characters): the live Vercel project may still hold it.
  assert.equal(breakGlassEnabled({ OPS_PASSWORD: "pick-something-strong" }), false);
  assert.equal(breakGlassEnabled({ OPS_PASSWORD: "Pick-Something-Strong " }), false, "whatever the case and spacing");
  const warnings = securityWarnings({ NODE_ENV: "production", OPS_PASSWORD: "pick-something-strong", SESSION_SECRET: "s".repeat(40) });
  assert.ok(warnings.some((w) => /OPS_PASSWORD is still the \.env\.example placeholder/.test(w)), warnings.join(" | "));
});

test("main's template values count as not set too: a template inbox, admin or domain is nobody's", () => {
  for (const v of ["pick-something-strong", "you@dang.ac", "you@example.com", "Breeze <quotes@yourdomain.co.uk>", "https://yourdomain.co.uk", "Dang It's Hot <hello@yourdomain.co.uk>"]) {
    assert.equal(isPlaceholderValue(v), true, v);
  }
  // Real values on the real domain stay real.
  for (const v of ["Dang, It's Hot <quotes@dang.ac>", "https://dang.ac", "hello@dang.ac", "jo@notyourdomain.co.uk"]) {
    assert.equal(isPlaceholderValue(v), false, v);
  }
  assert.deepEqual(
    placeholderKeys({ OPS_PASSWORD: "pick-something-strong", LEADS_NOTIFY_EMAIL: "you@dang.ac", ADMIN_EMAILS: "you@example.com", EMAIL_FROM: "Dang, It's Hot <quotes@dang.ac>" }),
    ["OPS_PASSWORD", "ADMIN_EMAILS", "LEADS_NOTIFY_EMAIL"],
    "named on /ops/launch and in the boot warnings",
  );
  assert.deepEqual(parseAdminEmails("you@example.com, Jo@Dang.ac"), ["jo@dang.ac"], "the template admin is dropped, the real one kept");
  assert.equal(isAdminEmail("you@example.com", "you@example.com"), false);
});

test("template values from .env.example count as not set", () => {
  for (const v of [
    "generate-with-openssl-rand-hex-32",
    "at-least-twenty-random-characters",
    "generate-a-long-random-string",
    "re_xxx",
    "sk_test_xxx",
    "whsec_xxx",
    "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "your-twilio-auth-token",
    "your-service-role-key",
    "https://YOUR-PROJECT.supabase.co",
    "sk-ant-...",
  ]) {
    assert.equal(isPlaceholderValue(v), true, v);
  }
  for (const v of ["", ["re", "8sJk2LmQ9xYz"].join("_"), ["sk", "test", "51NzQ2pLk"].join("_"), ["AC", "0123456789abcdef".repeat(2)].join(""), "4f9c0e7a2b1d8c6e", "https://abcd1234.supabase.co"]) {
    assert.equal(isPlaceholderValue(v), false, v);
  }
  assert.deepEqual(placeholderKeys({ RESEND_API_KEY: "re_xxx", STRIPE_SECRET_KEY: "sk_test_xxx", CRON_SECRET: "real-cron-6f1e" }), ["RESEND_API_KEY", "STRIPE_SECRET_KEY"]);
  assert.equal(cronSecret({ CRON_SECRET: "generate-a-long-random-string" }), null, "the crons refuse a template secret");
  assert.equal(cronSecret({ CRON_SECRET: "6f1e9a" }), "6f1e9a");
  assert.equal(stripeMode("sk_test_xxx"), "demo");
  assert.equal(stripeMode(["sk", "live", "51Nz"].join("_")), "live");
});

test("customer sign-in links only go to the customer's own address", () => {
  assert.equal(sameEmail(" Sam@Example.test", "sam@example.test "), true);
  assert.equal(sameEmail("", ""), false, "two blanks aren't a match");
  assert.equal(sameEmail(undefined, undefined), false);
  assert.equal(linkMayCarryToken("sam@example.test", "SAM@example.test"), true);
  assert.equal(linkMayCarryToken("sam@example.test", "attacker@example.test"), false);
  assert.equal(linkMayCarryToken("sam@example.test", null), false);
  assert.equal(linkMayCarryToken("not-an-email", "not-an-email"), false);

  // The email changed: the project moves to the new address's customer.
  assert.equal(relinkEmail("victim@example.test", "Attacker@Example.test"), "attacker@example.test");
  assert.equal(relinkEmail(undefined, "new@example.test"), "new@example.test");
  assert.equal(relinkEmail("sam@example.test", " SAM@example.test"), null, "same mailbox: no change");
  assert.equal(relinkEmail("sam@example.test", ""), null, "cleared: stays put, nothing is sent");
  assert.equal(relinkEmail("sam@example.test", "junk"), null);
  // ...and a link for the old customer never reaches the new address.
  assert.equal(linkMayCarryToken("victim@example.test", relinkEmail("victim@example.test", "attacker@example.test")), false);
});

test("maskEmail shows enough to recognise, not enough to learn", () => {
  assert.equal(maskEmail("Jo.Bloggs@Example.com"), "j***@example.com");
  assert.equal(maskEmail("a@b.co"), "a***@b.co");
  assert.equal(maskEmail("nonsense"), "***");
  assert.equal(maskEmail("@b.co"), "***");
});

test("emails: plausible shapes only", () => {
  assert.equal(isPlausibleEmail("a@b.co"), true);
  for (const bad of ["", "a", "a@b", "a b@c.co", "@b.co", "a@.co"]) assert.equal(isPlausibleEmail(bad), false, bad);
});

test("DEMO team: one per role, fictional, and the qualified ones pass their gates", () => {
  const all = DEMO_ROLE_KEYS.map((k) => DEMO_STAFF[k]);
  assert.equal(new Set(all.map((s) => s.id)).size, all.length, "unique ids");
  for (const s of all) {
    assert.equal(s.demo, true);
    assert.match(s.email, /\.invalid$/, "reserved TLD: can never receive mail");
    assert.match(s.name, /^DEMO /);
    assert.match(s.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "valid uuid for uuid columns");
    assert.equal(isDemoStaffId(s.id), true);
  }
  const on = "2026-10-18";
  assert.equal(meetsRequirement(DEMO_STAFF["tech-lead"], "tech-lead", on), true);
  assert.equal(meetsRequirement(DEMO_STAFF["tech-lead"], "fgas", on), true);
  assert.equal(meetsRequirement(DEMO_STAFF.electrician, "electrical", on), true);
  assert.equal(meetsRequirement(DEMO_STAFF.installer, "fgas", on), false);
  assert.equal(DEMO_STAFF["external-installer"].external, true);
  assert.equal(can(DEMO_STAFF["external-installer"], "finance.view-margin"), false);
  assert.equal(can(DEMO_STAFF.admin, "settings.edit"), true);
  assert.equal(isDemoRoleKey("admin"), true);
  assert.equal(isDemoRoleKey("superuser"), false);
  assert.equal(isDemoStaffId("de300000-0000-4000-8000-000000000999"), false);
});

test("securityWarnings: what the boot log shouts about in production", () => {
  const strong = "0123456789abcdef".repeat(4);
  assert.deepEqual(securityWarnings({ NODE_ENV: "development" }), [], "dev is quiet");
  assert.deepEqual(securityWarnings({ NODE_ENV: "production", SESSION_SECRET: strong, CRON_SECRET: strong }), [], "a clean production config");
  assert.match(securityWarnings({ NODE_ENV: "production", SESSION_SECRET: strong }).join(), /CRON_SECRET is not set: the daily jobs/);
  const pasted = securityWarnings({
    NODE_ENV: "production",
    SESSION_SECRET: "generate-with-openssl-rand-hex-32",
    OPS_PASSWORD: "at-least-twenty-random-characters",
    CRON_SECRET: "generate-a-long-random-string",
    RESEND_API_KEY: "re_xxx",
  }).join("\n");
  assert.match(pasted, /SESSION_SECRET is still the \.env\.example placeholder/);
  assert.match(pasted, /OPS_PASSWORD is still the \.env\.example placeholder/);
  assert.match(pasted, /CRON_SECRET, RESEND_API_KEY still hold \.env\.example placeholder values/);
  const all = securityWarnings({
    NODE_ENV: "production",
    SESSION_SECRET: "short",
    OPS_PASSWORD: "hunter2",
    ALLOW_DEMO_LOGIN: "1",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "k",
  }).join("\n");
  assert.match(all, /demo sign-in is REFUSED/);
  assert.match(all, /SESSION_SECRET is shorter than 32/);
  assert.match(all, /break-glass sign-in is off/);
  assert.match(securityWarnings({ NODE_ENV: "production", SESSION_SECRET: strong, ALLOW_DEMO_LOGIN: "1" }).join(), /DEMO sign-in is ON/);
  assert.match(securityWarnings({ NODE_ENV: "production" }).join(), /SESSION_SECRET is not set/);
});

test("a dead sign-in link never sends a customer to the team sign-in page", () => {
  const customer: CustomerSession = { kind: "customer", customerId: "c-1", email: "demo.alex@example.com", name: "DEMO Alex", projectIds: ["p-1"], exp: 0 };
  const both: CustomerSession = { ...customer, projectIds: ["p-1", "p-2"] };
  const staffSession: StaffSession = { kind: "staff", staffId: "s-1", email: "demo.ops@demo.dang.invalid", name: "DEMO Ops", roles: ["admin"], external: false, exp: 0 };
  const theirs = { kind: "customer" as const, subjectId: "c-1", email: "demo.alex@example.com", next: "/p/p-1/proposal" };
  const someoneElses = { ...theirs, subjectId: "c-2", next: "/p/p-9/proposal" };
  const staffLink = { kind: "staff" as const, subjectId: "s-1", email: "demo.ops@demo.dang.invalid", next: "/ops/projects/p-1" };

  // Still signed in: straight to where the link was going (yesterday's "Review your proposal").
  assert.equal(deadLinkLanding({ token: theirs, session: customer, reason: "expired" }), "/p/p-1/proposal");
  assert.equal(deadLinkLanding({ token: { ...theirs, next: "//evil.example" }, session: customer, reason: "expired" }), "/p/p-1", "never off-site");
  // Someone else's link, or an unknown one: their own home, not the other link's page.
  assert.equal(deadLinkLanding({ token: someoneElses, session: customer, reason: "expired" }), "/p/p-1");
  assert.equal(deadLinkLanding({ token: null, session: both, reason: "expired" }), "/portal");
  // Signed out: a customer page that explains and offers a fresh link.
  assert.equal(deadLinkLanding({ token: theirs, session: null, reason: "expired" }), "/portal?link=expired");
  assert.equal(deadLinkLanding({ token: null, session: null, reason: "missing" }), "/portal?link=missing");
  assert.equal(deadLinkLanding({ token: null, session: null, reason: "unavailable" }), "/portal?link=unavailable");
  // Staff links keep the team sign-in; a signed-in team member goes on to their page.
  assert.equal(deadLinkLanding({ token: staffLink, session: null, reason: "expired" }), "/login?error=expired");
  assert.equal(deadLinkLanding({ token: staffLink, session: staffSession, reason: "expired" }), "/ops/projects/p-1");
  assert.equal(deadLinkLanding({ token: null, session: staffSession, reason: "expired" }), "/ops");
  assert.equal(deadLinkLanding({ token: theirs, session: staffSession, reason: "expired" }), "/portal?link=expired", "a customer's link opened by staff");
});

test(".env.example ships no values: pasting it in can't set a public secret or a junk key", async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const set = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .filter((m) => m[2]!.trim() !== "");
  assert.deepEqual(set.map((m) => m[1]), [], "every variable is blank (or commented out)");
  assert.doesNotMatch(text, /^DATA_BACKEND=/m, "the local backend is opt-in, never pasted into Vercel");
});
