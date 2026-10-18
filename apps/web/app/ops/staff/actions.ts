"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { QUALIFICATION_LABEL, STAFF_ROLES, type QualificationKind, type StaffMember } from "@aircon/domain";
import { done, refused, type ActionResult } from "@/components/ops/command/types";
import { audit } from "@/lib/audit";
import { requireStaff } from "@/lib/auth/server";
import * as staffRepo from "@/lib/repo/staff";

/**
 * Staff and qualifications (admin only, audited). The whole record is
 * posted as JSON from the editor and validated here; qualifications are
 * facts with references and expiry dates, and "verified" is stamped with
 * the signed-in admin, never a typed name.
 */

const QUAL_KINDS = Object.keys(QUALIFICATION_LABEL) as [QualificationKind, ...QualificationKind[]];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

const qualificationSchema = z.object({
  kind: z.enum(QUAL_KINDS),
  reference: z.string().trim().min(1, "Every qualification needs its certificate or registration number").max(120),
  issuer: z.string().trim().max(120).optional().default(""),
  expiresOn: z.union([isoDate, z.literal("")]).optional().default(""),
  mediaId: z.union([uuid, z.literal("")]).optional().default(""),
  verified: z.boolean().optional().default(false),
  verifiedAt: z.string().max(40).optional(),
  verifiedBy: z.string().max(120).optional(),
});

const staffSchema = z.object({
  id: z.union([uuid, z.literal("")]),
  name: z.string().trim().min(2, "Enter their name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  phone: z.union([z.string().trim().regex(/^\+?[\d\s()-]{7,20}$/, "That phone number doesn't look right"), z.literal("")]),
  roles: z.array(z.enum(STAFF_ROLES as [string, ...string[]])).max(5),
  external: z.boolean(),
  active: z.boolean(),
  bio: z.string().trim().max(600),
  qualifications: z.array(qualificationSchema).max(20),
});

export async function saveStaffAction(fd: FormData): Promise<ActionResult> {
  const admin = await requireStaff("staff.edit");
  let raw: unknown;
  try {
    raw = JSON.parse(String(fd.get("payload") ?? "null"));
  } catch {
    return refused("The form didn't arrive in one piece. Please try again.");
  }
  const parsed = staffSchema.safeParse(raw);
  if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const d = parsed.data;
  if (d.roles.length === 0) return refused("Pick at least one role.");

  const existing = d.id ? await staffRepo.get(d.id) : null;
  if (d.id && !existing) return refused("That person isn't on the team any more. Reload the page.");

  // Never lock yourself (or the business) out.
  if (existing && existing.id === admin.id) {
    if (!d.active) return refused("You can't deactivate yourself. Ask another admin.");
    if (!d.roles.includes("admin")) return refused("You can't remove your own admin role. Ask another admin.");
  }
  if (existing?.roles.includes("admin") && existing.active && (!d.roles.includes("admin") || !d.active)) {
    const admins = (await staffRepo.list({ activeOnly: true })).filter((s) => s.roles.includes("admin") && !s.external && s.id !== existing.id);
    if (admins.length === 0) return refused("This is the only active admin. Make someone else an admin first.");
  }
  if (d.external && d.roles.includes("admin")) return refused("Subcontractors can't be admins.");

  const now = new Date().toISOString();
  const qualifications = d.qualifications.map((q) => {
    const before = existing?.qualifications.find((x) => x.kind === q.kind && x.reference === q.reference);
    const keepVerified = q.verified && before?.verifiedAt;
    return {
      kind: q.kind,
      reference: q.reference,
      ...(q.issuer ? { issuer: q.issuer } : {}),
      ...(q.expiresOn ? { expiresOn: q.expiresOn } : {}),
      ...(q.mediaId ? { mediaId: q.mediaId } : {}),
      ...(q.verified
        ? keepVerified
          ? { verifiedAt: before!.verifiedAt!, ...(before!.verifiedBy ? { verifiedBy: before!.verifiedBy } : {}) }
          : { verifiedAt: now, verifiedBy: admin.name }
        : {}),
    };
  });

  const record: Omit<StaffMember, "id"> = {
    email: d.email,
    name: d.name,
    ...(d.phone ? { phone: d.phone } : {}),
    roles: d.roles as StaffMember["roles"],
    external: d.external,
    active: d.active,
    qualifications,
    ...(d.bio ? { bio: d.bio } : {}),
    ...(existing?.photoMediaId ? { photoMediaId: existing.photoMediaId } : {}),
    ...(existing?.demo ? { demo: true } : {}),
  };

  try {
    if (existing) {
      const saved = await staffRepo.update({ ...record, id: existing.id }, admin);
      const changed = (Object.keys(record) as (keyof typeof record)[]).filter((k) => JSON.stringify(record[k]) !== JSON.stringify(existing[k]));
      await audit({ actor: admin, action: "staff.update", entity: "staff", entityId: saved.id, detail: { changed } });
      revalidatePath("/ops/staff");
      revalidatePath(`/ops/staff/${saved.id}`);
      return done(`${saved.name} saved.`);
    }
    const clash = await staffRepo.getByEmail(d.email);
    if (clash) return refused(`${d.email} is already on the team (${clash.name}).`);
    const saved = await staffRepo.insert(record, admin);
    await audit({ actor: admin, action: "staff.create", entity: "staff", entityId: saved.id, detail: { roles: saved.roles, external: saved.external } });
    revalidatePath("/ops/staff");
    return done(`${saved.name} added. They can sign in with ${saved.email}.`, { href: `/ops/staff/${saved.id}` });
  } catch (err) {
    if (err instanceof Error && /23505|duplicate|unique/i.test(err.message)) return refused(`${d.email} is already on the team.`);
    console.error("[staff] save failed:", err);
    return refused("The change couldn't be saved. Please try again.");
  }
}
