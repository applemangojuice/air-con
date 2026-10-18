import { STAFF_ROLES, type Qualification, type StaffMember, type StaffRole } from "@aircon/domain";
import { taintedByDemo } from "../auth/access";
import { compact, db, isUuid, jsonArray, must, nowIso, optStr, uuidOrNull, type Row } from "./base";

/**
 * `staff`: our team and subcontractors. Typed columns, no JSONB snapshot
 * (qualifications are the one JSON column). Emails are stored lower-case,
 * so sign-in matches however someone types theirs.
 *
 * Writes name who made them (`by`: the signed-in staff member, or null for
 * the system). A row written by a DEMO account is saved as demo itself, so
 * it dies with demo mode: a "Try as… Admin" visitor can't leave a real admin
 * account behind as a backdoor.
 */

/** Who's writing: a staff member (only `demo` matters here), or null for the system. */
export type StaffWriter = Pick<StaffMember, "demo"> | null;

const TABLE = "staff";

const isRole = (r: unknown): r is StaffRole => typeof r === "string" && (STAFF_ROLES as string[]).includes(r);

export function fromRow(row: Row): StaffMember {
  return compact<StaffMember>({
    id: String(row.id),
    email: String(row.email ?? ""),
    name: String(row.name ?? ""),
    phone: optStr(row.phone),
    roles: jsonArray<unknown>(row.roles).filter(isRole),
    external: row.external === true,
    active: row.active !== false,
    qualifications: jsonArray<Qualification>(row.qualifications),
    bio: optStr(row.bio),
    photoMediaId: optStr(row.photo_media_id),
    demo: row.demo === true ? true : undefined,
  });
}

export function toRow(s: StaffMember): Row {
  return {
    id: s.id,
    email: s.email.trim().toLowerCase(),
    name: s.name,
    phone: s.phone ?? null,
    roles: s.roles,
    external: s.external,
    active: s.active,
    qualifications: s.qualifications,
    bio: s.bio ?? null,
    photo_media_id: uuidOrNull(s.photoMediaId),
    demo: s.demo === true,
  };
}

export async function get(id: string): Promise<StaffMember | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "staff get");
  return data ? fromRow(data) : null;
}

export async function getByEmail(email: string): Promise<StaffMember | null> {
  const data = must(
    await db().from(TABLE).select("*").eq("email", email.trim().toLowerCase()).maybeSingle(),
    "staff getByEmail",
  );
  return data ? fromRow(data) : null;
}

export async function list(opts: { activeOnly?: boolean; includeDemo?: boolean } = {}): Promise<StaffMember[]> {
  let q = db().from(TABLE).select("*");
  if (opts.activeOnly) q = q.eq("active", true);
  if (opts.includeDemo === false) q = q.eq("demo", false);
  const data = must(await q.order("name", { ascending: true }), "staff list");
  return (data ?? []).map(fromRow);
}

/** Full records for a set of ids (e.g. a booking's crew). Unknown and non-uuid ids are skipped. */
export async function listByIds(ids: string[]): Promise<StaffMember[]> {
  const wanted = [...new Set(ids.filter(isUuid))];
  if (wanted.length === 0) return [];
  const data = must(await db().from(TABLE).select("*").in("id", wanted), "staff listByIds");
  return (data ?? []).map(fromRow);
}

/** Insert a new person. Throws on a duplicate email (callers look up first). */
export async function insert(member: Omit<StaffMember, "id"> & { id?: string }, by: StaffWriter): Promise<StaffMember> {
  const row = toRow(taintedByDemo({ ...member, id: member.id ?? crypto.randomUUID() }, by));
  const data = must(await db().from(TABLE).insert(row).select("*").single(), "staff insert");
  return fromRow(data!);
}

export async function update(member: StaffMember, by: StaffWriter): Promise<StaffMember> {
  const data = must(
    await db()
      .from(TABLE)
      .update({ ...toRow(taintedByDemo(member, by)), updated_at: nowIso() })
      .eq("id", member.id)
      .select("*")
      .maybeSingle(),
    "staff update",
  );
  if (!data) throw new Error(`staff update: ${member.id} not found`);
  return fromRow(data);
}
