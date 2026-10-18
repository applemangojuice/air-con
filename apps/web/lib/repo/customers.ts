import { compact, db, isUniqueViolation, isUuid, must, nowIso, optStr, type Row } from "./base";

/**
 * `customers`: the household behind one or more projects. The domain has no
 * customer type (a project carries the contact details it needs), so the
 * record is defined here. Consents are separate facts: operational messages
 * and marketing are different permissions, and null means never given.
 */

const TABLE = "customers";

export interface Consent {
  at: string;
  source: string;
  text: string;
}

export interface CustomerRecord {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  opsConsent: Consent | null;
  marketingConsent: Consent | null;
  createdAt?: string;
}

const consentOf = (v: unknown): Consent | null =>
  typeof v === "object" && v !== null && typeof (v as Consent).at === "string" ? (v as Consent) : null;

export function fromRow(row: Row): CustomerRecord {
  return compact<CustomerRecord>({
    id: String(row.id),
    email: String(row.email ?? ""),
    name: optStr(row.name),
    phone: optStr(row.phone),
    opsConsent: consentOf(row.ops_consent),
    marketingConsent: consentOf(row.marketing_consent),
    createdAt: optStr(row.created_at),
  });
}

function toRow(c: CustomerRecord): Row {
  return {
    id: c.id,
    email: c.email.trim().toLowerCase(),
    name: c.name ?? null,
    phone: c.phone ?? null,
    ops_consent: c.opsConsent,
    marketing_consent: c.marketingConsent,
  };
}

export async function get(id: string): Promise<CustomerRecord | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "customers get");
  return data ? fromRow(data) : null;
}

export async function getByEmail(email: string): Promise<CustomerRecord | null> {
  const data = must(
    await db().from(TABLE).select("*").eq("email", email.trim().toLowerCase()).maybeSingle(),
    "customers getByEmail",
  );
  return data ? fromRow(data) : null;
}

/**
 * The customer for this email, created on first sight. Fills a missing name
 * or phone on an existing record but never overwrites one. Safe under races:
 * the unique email makes a concurrent create collapse into a read.
 */
export async function findOrCreate(input: { email: string; name?: string; phone?: string }): Promise<CustomerRecord> {
  const email = input.email.trim().toLowerCase();
  const existing = await getByEmail(email);
  if (existing) {
    const patch: Row = {};
    if (!existing.name && input.name) patch.name = input.name;
    if (!existing.phone && input.phone) patch.phone = input.phone;
    if (Object.keys(patch).length === 0) return existing;
    const data = must(
      await db()
        .from(TABLE)
        .update({ ...patch, updated_at: nowIso() })
        .eq("id", existing.id)
        .select("*")
        .single(),
      "customers fill",
    );
    return fromRow(data!);
  }
  const res = await db()
    .from(TABLE)
    .insert({ email, name: input.name ?? null, phone: input.phone ?? null })
    .select("*")
    .single();
  if (isUniqueViolation(res.error)) {
    const raced = await getByEmail(email);
    if (raced) return raced;
  }
  return fromRow(must(res, "customers insert")!);
}

export async function update(customer: CustomerRecord): Promise<CustomerRecord> {
  const data = must(
    await db()
      .from(TABLE)
      .update({ ...toRow(customer), updated_at: nowIso() })
      .eq("id", customer.id)
      .select("*")
      .maybeSingle(),
    "customers update",
  );
  if (!data) throw new Error(`customers update: ${customer.id} not found`);
  return fromRow(data);
}

/** Every project this customer owns, newest first: what a portal session can open. */
export async function projectIdsFor(customerId: string): Promise<string[]> {
  if (!isUuid(customerId)) return [];
  const data = must(
    await db()
      .from("projects")
      .select("id")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false }),
    "customers projectIdsFor",
  );
  return (data ?? []).map((r) => String((r as Row).id));
}
