import type { StaffMember } from "@aircon/domain";

/**
 * The DEMO team behind the "Try as…" sign-in: one person per role, plus a
 * subcontractor, so every permission path can be walked without a real
 * account. Fictional people, `.invalid` email addresses (a reserved TLD that
 * can never receive mail) and DEMO certificate references.
 *
 * Fixed ids, so a demo session stays valid across restarts, instances and
 * the memory backend: lib/auth/server.ts recreates a missing demo row on
 * sight instead of signing the person out.
 */

export type DemoRoleKey = "admin" | "surveyor" | "tech-lead" | "installer" | "electrician" | "external-installer";

export const DEMO_ROLE_KEYS: DemoRoleKey[] = [
  "admin",
  "surveyor",
  "tech-lead",
  "installer",
  "electrician",
  "external-installer",
];

/** Long-dated so demo gates pass; still a real expiry, as the domain expects. */
const DEMO_EXPIRY = "2030-12-31";

export const DEMO_STAFF: Record<DemoRoleKey, StaffMember> = {
  admin: {
    id: "de300000-0000-4000-8000-000000000001",
    email: "demo.admin@demo.dang.invalid",
    name: "DEMO Ada (admin)",
    roles: ["admin"],
    external: false,
    active: true,
    qualifications: [],
    bio: "DEMO account: runs the business side.",
    demo: true,
  },
  surveyor: {
    id: "de300000-0000-4000-8000-000000000002",
    email: "demo.surveyor@demo.dang.invalid",
    name: "DEMO Sam (surveyor)",
    roles: ["surveyor"],
    external: false,
    active: true,
    qualifications: [],
    bio: "DEMO account: does the home surveys.",
    demo: true,
  },
  "tech-lead": {
    id: "de300000-0000-4000-8000-000000000003",
    email: "demo.techlead@demo.dang.invalid",
    name: "DEMO Tess (technical lead)",
    roles: ["tech-lead"],
    external: false,
    active: true,
    qualifications: [
      {
        kind: "fgas-cat1",
        reference: "DEMO-FGAS-0001",
        issuer: "DEMO certification body",
        expiresOn: DEMO_EXPIRY,
        verifiedBy: "DEMO seed",
      },
    ],
    bio: "DEMO account: signs off designs and commissioning.",
    demo: true,
  },
  installer: {
    id: "de300000-0000-4000-8000-000000000004",
    email: "demo.installer@demo.dang.invalid",
    name: "DEMO Ivo (installer)",
    roles: ["installer"],
    external: false,
    active: true,
    qualifications: [],
    bio: "DEMO account: on the tools.",
    demo: true,
  },
  electrician: {
    id: "de300000-0000-4000-8000-000000000005",
    email: "demo.electrician@demo.dang.invalid",
    name: "DEMO Eli (electrician)",
    roles: ["electrician"],
    external: false,
    active: true,
    qualifications: [
      {
        kind: "part-p",
        reference: "DEMO-PARTP-0001",
        issuer: "DEMO competent person scheme",
        expiresOn: DEMO_EXPIRY,
        verifiedBy: "DEMO seed",
      },
    ],
    bio: "DEMO account: the new circuit and its certificate.",
    demo: true,
  },
  "external-installer": {
    id: "de300000-0000-4000-8000-000000000006",
    email: "demo.subcontractor@demo.dang.invalid",
    name: "DEMO Xan (subcontractor)",
    roles: ["installer"],
    external: true,
    active: true,
    qualifications: [],
    bio: "DEMO account: a subcontractor who only sees the jobs they're on.",
    demo: true,
  },
};

export const DEMO_ROLE_LABEL: Record<DemoRoleKey, string> = {
  admin: "Admin",
  surveyor: "Surveyor",
  "tech-lead": "Technical lead",
  installer: "Installer",
  electrician: "Electrician",
  "external-installer": "Subcontractor",
};

const DEMO_IDS = new Set(Object.values(DEMO_STAFF).map((s) => s.id));

export function isDemoStaffId(id: string): boolean {
  return DEMO_IDS.has(id);
}

export function demoStaffById(id: string): StaffMember | undefined {
  return Object.values(DEMO_STAFF).find((s) => s.id === id);
}

export function isDemoRoleKey(value: unknown): value is DemoRoleKey {
  return typeof value === "string" && (DEMO_ROLE_KEYS as string[]).includes(value);
}
