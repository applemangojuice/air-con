import { invoiceNumber, mergeSettings, type Invoice } from "@aircon/domain";
import { db, isUniqueViolation, isUuid, jsonObject, must, nowIso, type Row } from "./base";
import * as settingsRepo from "./settings";

/**
 * `invoices`: deposit, balance, variation, fee and credit-note invoices.
 * `number` ("DIH-0001") is sequential, from the counter in settings
 * (`payments.nextInvoiceNumber`), and unique in the database, so a number is
 * never issued twice even if two invoices race. Migration 0013 adds two more
 * uniques: the form's `requestId`, and (project, `issueKey`), so two
 * invoices planned on the same state of the project can't both be made.
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

/**
 * Another invoice holds this one's place: the same request made it already
 * (`request`), or one planned on the same state of the project got there
 * first (`plan`). `number` was allocated and is left unused.
 */
export class InvoiceClashError extends Error {
  readonly clash: "request" | "plan";
  readonly number: string;
  constructor(clash: "request" | "plan", number: string) {
    super(clash === "request" ? "That request has already issued an invoice." : "Another invoice was issued on this project at the same moment.");
    this.name = "InvoiceClashError";
    this.clash = clash;
    this.number = number;
  }
}

/** Which unique a violation hit: the number (try the next one), or one of 0013's. */
function clashOf(error: { message?: string | null; details?: string | null }): "number" | "request" | "plan" {
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  if (text.includes("invoices_request_id_key")) return "request";
  if (text.includes("invoices_issue_key")) return "plan";
  return "number";
}

/**
 * Number and insert in one go, retrying with a fresh number if another
 * invoice took it first. A clash on the request or the plan throws
 * InvoiceClashError: a fresh number wouldn't help.
 */
export async function insertNumbered(invoice: Omit<Invoice, "number">): Promise<Invoice> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextNumber();
    const res = await db()
      .from(TABLE)
      .insert(toRow({ ...invoice, number }))
      .select("*")
      .single();
    if (isUniqueViolation(res.error)) {
      const clash = clashOf(res.error as { message?: string; details?: string });
      if (clash === "number") continue;
      throw new InvoiceClashError(clash, number);
    }
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
