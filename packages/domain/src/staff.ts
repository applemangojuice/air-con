/**
 * Staff, roles, permissions and qualifications.
 *
 * `can(staff, perm)` is the only permission check anywhere: pages, server
 * actions, API routes and the reducer's qualified-person guards all ask it.
 * Hiding a button is presentation; this is the rule.
 *
 * Qualifications are facts with references and expiry dates, never a
 * checkbox. Steps that legally need a certified person (refrigerant work,
 * notifiable electrics, commissioning sign-off) check `meetsRequirement`
 * against the date the work happens.
 */

/* ------------------------------------------------------------------ */
/* Roles + qualifications                                              */
/* ------------------------------------------------------------------ */

export type StaffRole = "admin" | "surveyor" | "tech-lead" | "installer" | "electrician";

export const STAFF_ROLES: StaffRole[] = ["admin", "tech-lead", "surveyor", "installer", "electrician"];

export const ROLE_LABEL: Record<StaffRole, string> = {
  admin: "Admin",
  surveyor: "Surveyor",
  "tech-lead": "Technical lead",
  installer: "Installer",
  electrician: "Electrician",
};

export type QualificationKind =
  | "fgas-cat1"
  | "part-p"
  | "18th-edition"
  | "pasma"
  | "ipaf"
  | "asbestos-awareness"
  | "first-aid";

export const QUALIFICATION_LABEL: Record<QualificationKind, string> = {
  "fgas-cat1": "F-gas Category I",
  "part-p": "Part P competent person scheme",
  "18th-edition": "18th Edition wiring regulations (BS 7671)",
  pasma: "PASMA mobile towers",
  ipaf: "IPAF powered access",
  "asbestos-awareness": "Asbestos awareness",
  "first-aid": "First aid at work",
};

export interface Qualification {
  kind: QualificationKind;
  reference: string;
  issuer?: string;
  expiresOn?: string;
  mediaId?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  phone?: string;
  roles: StaffRole[];
  external: boolean;
  active: boolean;
  qualifications: Qualification[];
  bio?: string;
  photoMediaId?: string;
  demo?: boolean;
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

export type Permission =
  | "projects.view-all"
  | "projects.edit"
  | "settings.edit"
  | "staff.edit"
  | "catalogue.edit"
  | "finance.view-margin"
  | "survey.conduct"
  | "design.edit"
  | "design.approve"
  | "proposal.edit"
  | "proposal.issue"
  | "schedule.edit"
  | "purchasing.edit"
  | "payments.record"
  | "compliance.review"
  | "install.work"
  | "install.review"
  | "commissioning.sign"
  | "messages.send"
  | "pilots.view";

export const PERMISSIONS: Permission[] = [
  "projects.view-all",
  "projects.edit",
  "settings.edit",
  "staff.edit",
  "catalogue.edit",
  "finance.view-margin",
  "survey.conduct",
  "design.edit",
  "design.approve",
  "proposal.edit",
  "proposal.issue",
  "schedule.edit",
  "purchasing.edit",
  "payments.record",
  "compliance.review",
  "install.work",
  "install.review",
  "commissioning.sign",
  "messages.send",
  "pilots.view",
];

/** What each role grants on its own. A person's permissions are the union. */
export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  admin: PERMISSIONS,
  "tech-lead": PERMISSIONS.filter((p) => p !== "settings.edit" && p !== "staff.edit"),
  surveyor: [
    "projects.view-all",
    "projects.edit",
    "survey.conduct",
    "design.edit",
    "proposal.edit",
    "finance.view-margin",
    "messages.send",
    "pilots.view",
  ],
  installer: ["install.work", "messages.send"],
  electrician: ["install.work"],
};

/**
 * Subcontractors work on the jobs they're assigned to and nothing else: no
 * board-wide view, no margins, no admin, no pilot dashboard.
 */
export const EXTERNAL_DENIED: ReadonlySet<Permission> = new Set<Permission>([
  "projects.view-all",
  "finance.view-margin",
  "settings.edit",
  "staff.edit",
  "pilots.view",
  "catalogue.edit",
]);

export function permissionsFor(staff: Pick<StaffMember, "roles" | "external" | "active">): Set<Permission> {
  const out = new Set<Permission>();
  if (!staff.active) return out;
  for (const role of staff.roles ?? []) {
    for (const perm of ROLE_PERMISSIONS[role] ?? []) {
      if (staff.external && EXTERNAL_DENIED.has(perm)) continue;
      out.add(perm);
    }
  }
  return out;
}

export function can(staff: Pick<StaffMember, "roles" | "external" | "active">, perm: Permission): boolean {
  return permissionsFor(staff).has(perm);
}

/* ------------------------------------------------------------------ */
/* Qualification checks                                                */
/* ------------------------------------------------------------------ */

/**
 * Held, with a reference, and not expired on the day in question. A
 * certificate is good through its expiry date.
 */
export function hasCurrentQualification(
  staff: Pick<StaffMember, "qualifications">,
  kind: QualificationKind,
  onIso: string,
): boolean {
  const on = onIso.slice(0, 10);
  return staff.qualifications.some(
    (q) =>
      q.kind === kind &&
      typeof q.reference === "string" &&
      q.reference.trim().length > 0 &&
      (!q.expiresOn || q.expiresOn.slice(0, 10) >= on),
  );
}

export type StepRequirement = "fgas" | "electrical" | "tech-lead";

export const REQUIREMENT_LABEL: Record<StepRequirement, string> = {
  fgas: "F-gas certified engineer",
  electrical: "Part P registered electrician",
  "tech-lead": "Technical lead with current F-gas certification",
};

/**
 * Who may do a gated step:
 *  * fgas: current F-gas Category I.
 *  * electrical: current Part P scheme membership (testing under a scheme
 *    member's supervision is real, but kept out of the pilot on purpose).
 *  * tech-lead: the tech-lead or admin role plus current F-gas Category I.
 */
export function meetsRequirement(staff: StaffMember, req: StepRequirement, onIso: string): boolean {
  if (!staff.active) return false;
  switch (req) {
    case "fgas":
      return hasCurrentQualification(staff, "fgas-cat1", onIso);
    case "electrical":
      return hasCurrentQualification(staff, "part-p", onIso);
    case "tech-lead":
      return (
        (staff.roles.includes("tech-lead") || staff.roles.includes("admin")) &&
        hasCurrentQualification(staff, "fgas-cat1", onIso)
      );
  }
}
