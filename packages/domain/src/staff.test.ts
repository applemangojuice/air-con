import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PERMISSIONS,
  QUALIFICATION_LABEL,
  ROLE_LABEL,
  STAFF_ROLES,
  can,
  hasCurrentQualification,
  isVerifiedQualification,
  meetsRequirement,
  permissionsFor,
  qualificationStatus,
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

test("external staff never see margins, the whole board, admin or pilots, nor make the office's edits", () => {
  const denied: Permission[] = [
    "projects.view-all",
    "projects.edit",
    "finance.view-margin",
    "settings.edit",
    "staff.edit",
    "pilots.view",
    "catalogue.edit",
    "proposal.issue",
    "schedule.edit",
    "purchasing.edit",
    "payments.record",
    "design.approve",
  ];
  for (const roles of [["admin"], ["tech-lead"], ["surveyor"]] as StaffRole[][]) {
    const ext = person(roles, { external: true });
    for (const p of denied) assert.ok(!can(ext, p), `${roles} external ${p}`);
  }
  const extLead = person(["tech-lead"], { external: true });
  assert.ok(can(extLead, "commissioning.sign")); // still does the job they're hired for
  assert.ok(can(extLead, "install.work"));
  assert.ok(can(person(["surveyor"], { external: true }), "survey.conduct"));
  assert.ok(can(person(["surveyor"], { external: true }), "design.edit")); // drafts; an employee signs it off
  // Editing the project record always comes with the board-wide view, so a project-wide edit is never a way round assignment.
  for (const roles of [["admin"], ["tech-lead"], ["surveyor"], ["installer"], ["electrician"]] as StaffRole[][]) {
    for (const external of [false, true]) {
      const s = person(roles, { external });
      if (can(s, "projects.edit")) assert.ok(can(s, "projects.view-all"), `${roles} ${external ? "external" : "employed"}`);
    }
  }
  assert.ok(can(person(["electrician"], { external: true }), "install.work"));
});

test("inactive staff have nothing", () => {
  assert.equal(permissionsFor(person(["admin"], { active: false })).size, 0);
  assert.ok(!can(person(["installer"], { active: false }), "install.work"));
});

/** Checked against the certificate by an admin, with the certificate on file. */
const VERIFIED = { verifiedAt: "2026-01-05T10:00:00.000Z", verifiedBy: "DEMO Ada", mediaId: "media-cert" };

test("qualifications are current through their expiry date, with a reference", () => {
  const s = person(["installer"], {
    qualifications: [
      { kind: "fgas-cat1", reference: "FG-1", expiresOn: "2026-10-18", ...VERIFIED },
      { kind: "part-p", reference: "  ", expiresOn: "2030-01-01", ...VERIFIED },
      { kind: "pasma", reference: "P-1", ...VERIFIED },
    ],
  });
  assert.ok(hasCurrentQualification(s, "fgas-cat1", "2026-10-18"));
  assert.ok(hasCurrentQualification(s, "fgas-cat1", "2026-10-18T23:00:00.000Z"));
  assert.ok(!hasCurrentQualification(s, "fgas-cat1", "2026-10-19"));
  assert.ok(!hasCurrentQualification(s, "part-p", ON)); // no reference, no qualification
  assert.ok(hasCurrentQualification(s, "pasma", "2099-01-01")); // no expiry
  assert.ok(!hasCurrentQualification(s, "ipaf", ON));
  // A renewed certificate alongside the lapsed one counts.
  const renewed = { qualifications: [...s.qualifications, { kind: "fgas-cat1" as const, reference: "FG-2", expiresOn: "2031-10-18", ...VERIFIED }] };
  assert.ok(hasCurrentQualification(renewed, "fgas-cat1", "2027-01-01"));
});

test("a qualification counts only once it's verified with the certificate on file", () => {
  const typed = { kind: "fgas-cat1" as const, reference: "TBC", expiresOn: "2030-01-01" };
  assert.equal(qualificationStatus(typed, ON), "unverified", "a typed reference nobody checked");
  assert.equal(qualificationStatus({ ...typed, verifiedAt: VERIFIED.verifiedAt }, ON), "unverified", "ticked, but no certificate on file");
  assert.equal(qualificationStatus({ ...typed, mediaId: "m" }, ON), "unverified", "a file, but nobody checked it");
  assert.equal(qualificationStatus({ ...typed, ...VERIFIED }, ON), "current");
  assert.equal(qualificationStatus({ ...typed, ...VERIFIED, expiresOn: "2020-01-01" }, ON), "expired");
  assert.equal(isVerifiedQualification({ reference: " ", ...VERIFIED }), false);
  assert.ok(!hasCurrentQualification({ qualifications: [typed] }, "fgas-cat1", ON));
  assert.ok(!meetsRequirement(person(["tech-lead"], { qualifications: [typed] }), "tech-lead", ON), "no sign-off on an unchecked certificate");
  assert.ok(meetsRequirement(person(["tech-lead"], { qualifications: [{ ...typed, ...VERIFIED }] }), "tech-lead", ON));
});

test("meetsRequirement: fgas, electrical, tech-lead", () => {
  const fgas = { kind: "fgas-cat1" as const, reference: "FG-1", expiresOn: "2027-01-31", ...VERIFIED };
  const partP = { kind: "part-p" as const, reference: "SCHEME-1", expiresOn: "2027-01-31", ...VERIFIED };
  const eighteenth = { kind: "18th-edition" as const, reference: "C&G-1", ...VERIFIED };

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
