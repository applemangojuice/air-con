import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PERMISSIONS,
  QUALIFICATION_LABEL,
  ROLE_LABEL,
  STAFF_ROLES,
  can,
  hasCurrentQualification,
  meetsRequirement,
  permissionsFor,
  type Permission,
  type StaffMember,
  type StaffRole,
} from "./staff.ts";

function person(roles: StaffRole[], over: Partial<StaffMember> = {}): StaffMember {
  return {
    id: `s-${roles.join("-")}`,
    email: "demo@example.test",
    name: "Demo Person",
    roles,
    external: false,
    active: true,
    qualifications: [],
    demo: true,
    ...over,
  };
}

const ON = "2026-10-18";
const sorted = (s: Set<Permission>) => [...s].sort();

test("admin holds every permission", () => {
  assert.deepEqual(sorted(permissionsFor(person(["admin"]))), [...PERMISSIONS].sort());
});

test("tech lead holds everything but settings and staff admin", () => {
  const perms = permissionsFor(person(["tech-lead"]));
  assert.equal(perms.size, PERMISSIONS.length - 2);
  assert.ok(!perms.has("settings.edit"));
  assert.ok(!perms.has("staff.edit"));
  for (const p of ["design.approve", "compliance.review", "install.review", "commissioning.sign"] as Permission[]) {
    assert.ok(perms.has(p), p);
  }
});

test("surveyor, installer and electrician get exactly their slice", () => {
  assert.deepEqual(sorted(permissionsFor(person(["surveyor"]))), [
    "design.edit",
    "finance.view-margin",
    "messages.send",
    "pilots.view",
    "projects.edit",
    "projects.view-all",
    "proposal.edit",
    "survey.conduct",
  ]);
  assert.deepEqual(sorted(permissionsFor(person(["installer"]))), ["install.work", "messages.send"]);
  assert.deepEqual(sorted(permissionsFor(person(["electrician"]))), ["install.work"]);
  assert.ok(!can(person(["surveyor"]), "design.approve"));
  assert.ok(!can(person(["surveyor"]), "proposal.issue"));
  assert.ok(!can(person(["installer"]), "projects.view-all"));
});

test("roles combine as a union", () => {
  const both = permissionsFor(person(["surveyor", "installer"]));
  assert.ok(both.has("survey.conduct"));
  assert.ok(both.has("install.work"));
  assert.ok(!both.has("design.approve"));
});

test("external staff never see margins, the whole board, admin or pilots", () => {
  const denied: Permission[] = ["projects.view-all", "finance.view-margin", "settings.edit", "staff.edit", "pilots.view", "catalogue.edit"];
  for (const roles of [["admin"], ["tech-lead"], ["surveyor"]] as StaffRole[][]) {
    const ext = person(roles, { external: true });
    for (const p of denied) assert.ok(!can(ext, p), `${roles} external ${p}`);
  }
  const extLead = person(["tech-lead"], { external: true });
  assert.ok(can(extLead, "commissioning.sign")); // still does the job they're hired for
  assert.ok(can(extLead, "install.work"));
  assert.ok(can(person(["surveyor"], { external: true }), "survey.conduct"));
  assert.ok(can(person(["electrician"], { external: true }), "install.work"));
});

test("inactive staff have nothing", () => {
  assert.equal(permissionsFor(person(["admin"], { active: false })).size, 0);
  assert.ok(!can(person(["installer"], { active: false }), "install.work"));
});

test("qualifications are current through their expiry date, with a reference", () => {
  const s = person(["installer"], {
    qualifications: [
      { kind: "fgas-cat1", reference: "FG-1", expiresOn: "2026-10-18" },
      { kind: "part-p", reference: "  ", expiresOn: "2030-01-01" },
      { kind: "pasma", reference: "P-1" },
    ],
  });
  assert.ok(hasCurrentQualification(s, "fgas-cat1", "2026-10-18"));
  assert.ok(hasCurrentQualification(s, "fgas-cat1", "2026-10-18T23:00:00.000Z"));
  assert.ok(!hasCurrentQualification(s, "fgas-cat1", "2026-10-19"));
  assert.ok(!hasCurrentQualification(s, "part-p", ON)); // no reference, no qualification
  assert.ok(hasCurrentQualification(s, "pasma", "2099-01-01")); // no expiry
  assert.ok(!hasCurrentQualification(s, "ipaf", ON));
  // A renewed certificate alongside the lapsed one counts.
  const renewed = { qualifications: [...s.qualifications, { kind: "fgas-cat1" as const, reference: "FG-2", expiresOn: "2031-10-18" }] };
  assert.ok(hasCurrentQualification(renewed, "fgas-cat1", "2027-01-01"));
});

test("meetsRequirement: fgas, electrical, tech-lead", () => {
  const fgas = { kind: "fgas-cat1" as const, reference: "FG-1", expiresOn: "2027-01-31" };
  const partP = { kind: "part-p" as const, reference: "SCHEME-1", expiresOn: "2027-01-31" };
  const eighteenth = { kind: "18th-edition" as const, reference: "C&G-1" };

  const installer = person(["installer"], { qualifications: [fgas] });
  assert.ok(meetsRequirement(installer, "fgas", ON));
  assert.ok(!meetsRequirement(installer, "electrical", ON));
  assert.ok(!meetsRequirement(installer, "tech-lead", ON)); // F-gas alone isn't a tech lead

  const sparky = person(["electrician"], { qualifications: [eighteenth] });
  assert.ok(!meetsRequirement(sparky, "electrical", ON)); // pilot rule: Part P only
  assert.ok(meetsRequirement({ ...sparky, qualifications: [partP] }, "electrical", ON));

  const lead = person(["tech-lead"], { qualifications: [fgas] });
  assert.ok(meetsRequirement(lead, "tech-lead", ON));
  assert.ok(!meetsRequirement(lead, "tech-lead", "2027-02-01")); // lapsed
  assert.ok(!meetsRequirement(person(["tech-lead"]), "tech-lead", ON)); // role without the ticket
  assert.ok(meetsRequirement(person(["admin"], { qualifications: [fgas] }), "tech-lead", ON));
  assert.ok(!meetsRequirement({ ...lead, active: false }, "tech-lead", ON));
  assert.ok(!meetsRequirement({ ...installer, active: false }, "fgas", ON));
});

test("labels cover every role and qualification", () => {
  for (const role of STAFF_ROLES) assert.ok(ROLE_LABEL[role]);
  assert.equal(Object.keys(QUALIFICATION_LABEL).length, 7);
  for (const label of Object.values(QUALIFICATION_LABEL)) assert.ok(label.length > 3);
});
