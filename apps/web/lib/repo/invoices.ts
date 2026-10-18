import { invoiceNumber, mergeSettings, type Invoice } from "@aircon/domain";
import { db, isUniqueViolation, isUuid, jsonObject, must, nowIso, type Row } from "./base";
import * as settingsRepo from "./settings";

/**
 * `invoices`: deposit, balance, variation, fee and credit-note invoices.
 * `number` ("DIH-0001") is sequential, from the counter in settings
 * (`payments.nextInvoiceNumber`), and unique in the database, so a number is
 * never issued twice even if two invoices race.
 */

const TABLE = "invoices";

export function fromRow(row: Row): Invoice {
  return {
    ...jsonObject<Invoice>(row.invoice),
    id: String(row.id),
    projectId: String(row.project_id),
    number: String(row.number),
  };
}

export function toRow(invoice: Invoice): Row {
  return {
    id: invoice.id,
    project_id: invoice.projectId,
    number: invoice.number,
    kind: invoice.kind,
    status: invoice.status,
    total_pence: invoice.totalPence,
    paid_pence: invoice.paidPence,
    invoice,
  };
}

export async function get(id: string): Promise<Invoice | null> {
  if (!isUuid(id)) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "invoices get");
  return data ? fromRow(data) : null;
}

export async function getByNumber(number: string): Promise<Invoice | null> {
  const data = must(await db().from(TABLE).select("*").eq("number", number).maybeSingle(), "invoices getByNumber");
  return data ? fromRow(data) : null;
}

export async function listForProject(projectId: string): Promise<Invoice[]> {
  if (!isUuid(projectId)) return [];
  const data = must(
    await db().from(TABLE).select("*").eq("project_id", projectId).order("created_at", { ascending: true }),
    "invoices listForProject",
  );
  return (data ?? []).map(fromRow);
}

export async function list(opts: { statuses?: Invoice["status"][] } = {}): Promise<Invoice[]> {
  let q = db().from(TABLE).select("*");
  if (opts.statuses) q = q.in("status", opts.statuses);
  const data = must(await q.order("created_at", { ascending: false }), "invoices list");
  return (data ?? []).map(fromRow);
}

/**
 * Take the next invoice number from the settings counter and advance it.
 * Skips any number already used (a counter reset by hand never reissues
 * one). Prefer `insertNumbered`, which also survives a race.
 */
export async function nextNumber(): Promise<string> {
  const settings = mergeSettings(await settingsRepo.getValue(settingsRepo.PILOT_SETTINGS_KEY));
  const prefix = settings.payments.invoicePrefix;
  let n = Math.max(1, Math.floor(settings.payments.nextInvoiceNumber));
  for (let guard = 0; guard < 1000 && (await getByNumber(invoiceNumber(prefix, n))); guard++) n++;
  const next = { ...settings, payments: { ...settings.payments, nextInvoiceNumber: n + 1 } };
  await settingsRepo.setValue(settingsRepo.PILOT_SETTINGS_KEY, next, "invoice counter");
  return invoiceNumber(prefix, n);
}

export async function insert(invoice: Invoice): Promise<Invoice> {
  const data = must(await db().from(TABLE).insert(toRow(invoice)).select("*").single(), "invoices insert");
  return fromRow(data!);
}

/** Number and insert in one go, retrying with a fresh number if another invoice took it first. */
export async function insertNumbered(invoice: Omit<Invoice, "number">): Promise<Invoice> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextNumber();
    const res = await db()
      .from(TABLE)
      .insert(toRow({ ...invoice, number }))
      .select("*")
      .single();
    if (isUniqueViolation(res.error)) continue;
    return fromRow(must(res, "invoices insert")!);
  }
  throw new Error("invoices insertNumbered: could not allocate a free invoice number");
}

export async function update(invoice: Invoice): Promise<Invoice> {
  const data = must(
    await db()
      .from(TABLE)
      .update({ ...toRow(invoice), updated_at: nowIso() })
      .eq("id", invoice.id)
      .select("*")
      .maybeSingle(),
    "invoices update",
  );
  if (!data) throw new Error(`invoices update: ${invoice.id} not found`);
  return fromRow(data);
}
