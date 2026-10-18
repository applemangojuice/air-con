import { test } from "node:test";
import assert from "node:assert/strict";
import { can, meetsRequirement, type StaffMember } from "@aircon/domain";
import {
  customerCanAccessProject,
  decideProjectAccess,
  decideStaffGate,
  demoLoginAllowed,
  isAdminEmail,
  isAssigned,
  isPlausibleEmail,
  parseAdminEmails,
  safeNextPath,
  staffCanAccessProject,
  staffHome,
  staffLanding,
} from "../lib/auth/access.ts";
import { DEMO_ROLE_KEYS, DEMO_STAFF, isDemoRoleKey, isDemoStaffId } from "../lib/auth/demo-staff.ts";
import type { CustomerSession, StaffSession } from "../lib/auth/session.ts";

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

test("decideStaffGate: signed out, forbidden or ok", () => {
  assert.equal(decideStaffGate(null), "signed-out");
  assert.equal(decideStaffGate(leaver), "signed-out", "inactive is signed out");
  assert.equal(decideStaffGate(installer), "ok");
  assert.equal(decideStaffGate(installer, "settings.edit"), "forbidden");
  assert.equal(decideStaffGate(admin, "settings.edit"), "ok");
  assert.equal(decideStaffGate(person("lead", { roles: ["tech-lead"] }), "staff.edit"), "forbidden");
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
  ]) {
    assert.equal(safeNextPath(bad as string | null | undefined, F), F, JSON.stringify(bad));
  }
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

test("demo sign-in: outside production, or production with ALLOW_DEMO_LOGIN=1", () => {
  assert.equal(demoLoginAllowed({ NODE_ENV: "development" }), true);
  assert.equal(demoLoginAllowed({ NODE_ENV: "test" }), true);
  assert.equal(demoLoginAllowed({ NODE_ENV: "production" }), false);
  assert.equal(demoLoginAllowed({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "1" }), true);
  assert.equal(demoLoginAllowed({ NODE_ENV: "production", ALLOW_DEMO_LOGIN: "true" }), false, "exactly 1");
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
