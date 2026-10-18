import type { Payment } from "@aircon/domain";
import { db, isUniqueViolation, isUuid, jsonObject, must, uuidOrNull, type Row } from "./base";

/**
 * `payments`: verified payments only (nothing is "paid" without a row here).
 * `provider_ref` is unique, so a replayed Stripe webhook or a double-clicked
 * "record payment" can't count the same money twice.
 */

const TABLE = "payments";

export function fromRow(row: Row): Payment {
  return {
    ...jsonObject<Payment>(row.payment),
    id: String(row.id),
    projectId: String(row.project_id),
    providerRef: String(row.provider_ref),
  };
}

export function toRow(payment: Payment): Row {
  return {
    id: payment.id,
    project_id: payment.projectId,
    invoice_id: uuidOrNull(payment.invoiceId),
    provider_ref: payment.providerRef,
    provider: payment.provider,
    method: payment.method,
    amount_pence: payment.amountPence,
    status: payment.status,
    received_at: payment.receivedAt,
    payment,
  };
}

export async function get(id: string): Promise<Payment | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "payments get");
  return data ? fromRow(data) : null;
}

export async function getByProviderRef(providerRef: string): Promise<Payment | null> {
  const data = must(
    await db().from(TABLE).select("*").eq("provider_ref", providerRef).maybeSingle(),
    "payments getByProviderRef",
  );
  return data ? fromRow(data) : null;
}

export async function listForProject(projectId: string): Promise<Payment[]> {
  if (!isUuid(projectId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).order("received_at", { ascending: true }),
    "payments listForProject",
  );
  return (data ?? []).map(fromRow);
}

export async function listForInvoice(invoiceId: string): Promise<Payment[]> {
  if (!isUuid(invoiceId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("invoice_id", invoiceId).order("received_at", { ascending: true }),
    "payments listForInvoice",
  );
  return (data ?? []).map(fromRow);
}

/**
 * Record a payment once. A second record with the same provider reference
 * returns the first, flagged `duplicate`, so the caller skips applying it.
 */
export async function insertIdempotent(payment: Payment): Promise<{ payment: Payment; duplicate: boolean }> {
  const res = await db().from(TABLE).insert(toRow(payment)).select("*").single();
  if (isUniqueViolation(res.error)) {
    const existing = await getByProviderRef(payment.providerRef);
    if (existing) return { payment: existing, duplicate: true };
  }
  return { payment: fromRow(must(res, "payments insert")!), duplicate: false };
}

/** Status changes (e.g. a refund). No updated_at on this table. */
export async function update(payment: Payment): Promise<Payment> {
  const data = must(
    await db().from(TABLE).update(toRow(payment)).eq("id", payment.id).select("*").maybeSingle(),
    "payments update",
  );
  if (!data) throw new Error(`payments update: ${payment.id} not found`);
  return fromRow(data);
}
