import type { PilotSettings, TaxCodeId } from "./settings.ts";

/**
 * Invoices and payments, in integer pence.
 *
 * A payment exists only when something verifiable says so: a Stripe webhook
 * with a valid signature, or a person recording a bank transfer they've
 * seen. Each provider reference is unique, so a replayed webhook can't pay
 * twice. Invoices are numbered from settings and never renumbered.
 *
 * Foundation ships the types and numbering; F5 owns the rest.
 */

export type InvoiceKind = "deposit" | "balance" | "variation" | "survey-fee" | "change-fee" | "credit-note";

export interface InvoiceLine {
  label: string;
  netPence: number;
  taxCode: TaxCodeId;
  taxPence: number;
  totalPence: number;
}

export interface Invoice {
  id: string;
  projectId: string;
  number: string;
  kind: InvoiceKind;
  status: "draft" | "issued" | "part-paid" | "paid" | "void";
  lines: InvoiceLine[];
  netPence: number;
  taxPence: number;
  totalPence: number;
  paidPence: number;
  dueOn?: string;
  issuedAt?: string;
  documentId?: string;
  notes?: string;
}

export interface Payment {
  id: string;
  projectId: string;
  invoiceId?: string;
  method: "card" | "bank-transfer" | "cash" | "other";
  provider: "stripe" | "manual" | "demo";
  providerRef: string;
  amountPence: number;
  status: "succeeded" | "pending" | "failed" | "refunded";
  receivedAt: string;
  recordedBy?: string;
}

/** "DIH", 1 → "DIH-0001". Pads to four digits and never truncates past them. */
export function invoiceNumber(prefix: string, n: number): string {
  const clean = prefix.trim().toUpperCase();
  const digits = String(Math.max(0, Math.floor(n))).padStart(4, "0");
  return clean ? `${clean}-${digits}` : digits;
}

export function depositPence(contractTotalPence: number, settings: PilotSettings): number {
  throw new Error("not implemented: depositPence (F5)");
}

export function buildBalanceInvoiceLines(input: {
  contractTotalPence: number;
  acceptedVariationsPence: number;
  changeFeesPence: number;
  alreadyInvoicedPence: number;
  taxCode: TaxCodeId;
}): InvoiceLine[] {
  throw new Error("not implemented: buildBalanceInvoiceLines (F5)");
}

export function applyPayment(invoice: Invoice, amountPence: number): Invoice {
  throw new Error("not implemented: applyPayment (F5)");
}

export function outstandingPence(invoices: Invoice[]): number {
  throw new Error("not implemented: outstandingPence (F5)");
}
