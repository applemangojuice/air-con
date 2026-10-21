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

/**
 * The consents the quote funnel recorded (`quote_requests.attribution.consents`,
 * components/site/claims.ts quoteConsentRecord) as customer consent facts.
 * Null when the quote carries none (older quotes, ops-created projects).
 * Marketing is only ever a consent when it was actually ticked.
 */
export function consentsFromQuote(attribution: unknown): { ops: Consent | null; marketing: Consent | null; at: string } | null {
  if (typeof attribution !== "object" || attribution === null) return null;
  const raw = (attribution as { consents?: unknown }).consents;
  if (typeof raw !== "object" || raw === null) return null;
  type Entry = { given?: unknown; at?: unknown; text?: unknown; version?: unknown; channels?: unknown; source?: unknown };
  const fact = (e: unknown): Consent | null => {
    if (typeof e !== "object" || e === null) return null;
    const x = e as Entry;
    if (x.given !== true || typeof x.at !== "string" || typeof x.text !== "string") return null;
    const channels = Array.isArray(x.channels) ? x.channels.filter((c): c is string => typeof c === "string") : [];
    const version = typeof x.version === "string" ? x.version : "unversioned";
    const source = typeof x.source === "string" ? x.source : "quote-funnel";
    return { at: x.at, source: `${source} (${version}${channels.length ? `; ${channels.join(", ")}` : ""})`, text: x.text };
  };
  const { operational, marketing } = raw as { operational?: Entry; marketing?: Entry };
  const at = typeof operational?.at === "string" ? operational.at : typeof marketing?.at === "string" ? marketing.at : "";
  if (!at) return null;
  return { ops: fact(operational), marketing: fact(marketing), at };
}

/**
 * Record a quote's consents on the customer. The latest answer wins: a newer
 * quote with marketing unticked clears an older marketing consent (never
 * assume one), and an older quote never overwrites a newer record.
 */
export async function recordQuoteConsents(customer: CustomerRecord, consents: NonNullable<ReturnType<typeof consentsFromQuote>>): Promise<CustomerRecord> {
  // The newest answer on record (a cleared marketing consent leaves the operational one's time behind).
  const latest = [customer.opsConsent?.at, customer.marketingConsent?.at].filter((x): x is string => Boolean(x)).sort().at(-1);
  if (latest && latest > consents.at) return customer;
  return update({
    ...customer,
    opsConsent: consents.ops ?? customer.opsConsent,
    marketingConsent: consents.marketing,
  });
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
