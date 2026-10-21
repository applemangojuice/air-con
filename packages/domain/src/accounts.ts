import { INVOICE_KIND_LABEL, creditPurposeOf, invoiceOutstanding, outstandingPence, settleInvoice, type Invoice, type Payment } from "./money.ts";
import { TAX_CODES, type TaxCodeId } from "./settings.ts";

/**
 * The accountant's export (§K45): every invoice, credit note, payment and
 * refund in a date range, and the totals that reconcile them, as CSV. Pure:
 * the web route loads the rows and the ranges; this decides what they say.
 *
 *  * Dates are London calendar days (an instant's Europe/London date), and
 *    the range includes both ends.
 *  * Money is pounds to two decimals; refunds and credit notes are
 *    negative. Text cells a spreadsheet would run as a formula (= + - @ tab
 *    CR) get a leading apostrophe; money cells are only ever our own
 *    "-12.34" digits, so they stay numbers.
 *  * A cancelled contract is never revenue: its invoices and credit notes
 *    count nothing towards it, except the charge for the work done before
 *    the cancellation (CCR reg 36(4)) and any credit against that charge.
 *  * DEMO payments (no money moved) are listed but never counted, and so
 *    are payments still pending or that failed.
 *  * "Owed at the end date" is rebuilt as things stood at the end of that
 *    day: invoices issued by then (a voided one only until it was voided,
 *    when that's known), payments and refunds received by then.
 */

export interface AccountsProject {
  id: string;
  /** How the office refers to it: "Pilot 2", or the project's short id. */
  ref: string;
  /** The customer's reference (their record's short id), or "" with none yet. */
  customerRef: string;
  customerName: string;
  /** The contract was cancelled (or the project closed as cancelled). */
  cancelled: boolean;
}

export interface AccountsInput {
  /** yyyy-mm-dd, London, inclusive. */
  from: string;
  to: string;
  invoices: Invoice[];
  payments: Payment[];
  projects: AccountsProject[];
  /** Registered for VAT: the net and VAT columns are filled. */
  vatRegistered: boolean;
}

/** The longest range one export covers (three years: a financial year or a VAT quarter fits easily). */
export const ACCOUNTS_MAX_DAYS = 1096;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why this range can't be exported, or null. */
export function accountsRangeProblem(from: string, to: string): string | null {
  const valid = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
  if (!valid(from) || !valid(to)) return "Pick a start and an end date.";
  if (from > to) return "The start date is after the end date.";
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
  if (days > ACCOUNTS_MAX_DAYS) return "That's more than three years: export it in parts.";
  return null;
}

/** The London calendar day of an instant (yyyy-mm-dd). A bare date is itself. */
export function londonDayOf(iso: string): string {
  if (DATE.test(iso)) return iso;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
  const get = (k: string) => parts.find((x) => x.type === k)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* ------------------------------------------------------------------ */
/* Cells                                                               */
/* ------------------------------------------------------------------ */

const MONEY = /^-?\d+\.\d{2}$/;

/** Pence as pounds to two decimals: "1234.50", "-12.00". */
export function poundsCell(pence: number): string {
  const p = Math.round(pence);
  const abs = Math.abs(p);
  return `${p < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * One CSV cell. Text a spreadsheet would read as a formula (starting = + -
 * @, a tab or a CR) gets a leading apostrophe; quoted when it holds a comma,
 * a quote or a line break. Our own money figures ("-12.34") are left as
 * numbers.
 */
export function accountsCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (!(typeof value === "number" || MONEY.test(s)) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (header: string[], rows: (string | number | null | undefined)[][]): string =>
  [header, ...rows].map((r) => r.map(accountsCell).join(",")).join("\r\n") + "\r\n";

/* ------------------------------------------------------------------ */
/* Shared facts                                                        */
/* ------------------------------------------------------------------ */

const live = (i: Invoice) => i.status !== "draft" && i.status !== "void";
const inRange = (day: string, input: Pick<AccountsInput, "from" | "to">) => Boolean(day) && day >= input.from && day <= input.to;
const issuedOn = (i: Invoice) => londonDayOf(i.issuedAt ?? i.createdAt ?? "");
/** Real money we can count: not DEMO, and succeeded (in) or refunded (out). */
const counted = (p: Payment) => p.provider !== "demo" && (p.status === "succeeded" || p.status === "refunded");

const METHOD: Record<Payment["method"], string> = { card: "Card", "bank-transfer": "Bank transfer", cash: "Cash", other: "Other" };
const PROVIDER: Record<Payment["provider"], string> = { stripe: "Stripe", manual: "Recorded by hand", demo: "DEMO (no money moved)" };

/** Does this invoice count as revenue? Not on a cancelled contract, except the charge for work done (and credit against it). */
function revenueNet(inv: Invoice, all: Invoice[], cancelled: boolean): number {
  if (!live(inv)) return 0;
  if (!cancelled) return inv.netPence;
  if (inv.kind === "cancellation-charge") return inv.netPence;
  if (inv.kind === "credit-note" && inv.creditsInvoiceId && all.find((t) => t.id === inv.creditsInvoiceId)?.kind === "cancellation-charge") return inv.netPence;
  return 0;
}

function taxOf(inv: Invoice): { code: string; ratePct: string } {
  const codes = [...new Set(inv.lines.map((l) => l.taxCode))] as TaxCodeId[];
  const rate = codes.length === 1 ? TAX_CODES[codes[0]!]?.ratePct : undefined;
  return { code: codes.join("+"), ratePct: rate === undefined ? "" : String(rate) };
}

/** Invoices and payments as they stood at the end of `day`, per project, with paid amounts rebuilt from those payments. */
function asOf(input: AccountsInput, day: string): Map<string, Invoice[]> {
  const pays = input.payments.filter((p) => counted(p) && londonDayOf(p.receivedAt) <= day);
  const out = new Map<string, Invoice[]>();
  for (const inv of input.invoices) {
    if (inv.status === "draft") continue;
    if (issuedOn(inv) > day) continue;
    // Voided: gone, unless we know it was voided after that day (then it was live).
    if (inv.status === "void" && !(inv.voidedAt && londonDayOf(inv.voidedAt) > day)) continue;
    const then = settleInvoice({ ...inv, status: inv.status === "void" ? "issued" : inv.status }, pays);
    out.set(inv.projectId, [...(out.get(inv.projectId) ?? []), then]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The three files                                                     */
/* ------------------------------------------------------------------ */

export const INVOICE_COLUMNS = [
  "type",
  "number",
  "issued_on",
  "due_on",
  "kind",
  "project_ref",
  "customer_ref",
  "customer_name",
  "net_gbp",
  "vat_gbp",
  "total_gbp",
  "tax_code",
  "vat_rate_pct",
  "credits_invoice",
  "credit_purpose",
  "description",
  "status",
  "paid_by_end_gbp",
  "owed_at_end_gbp",
  "cancelled_contract",
  "revenue_net_gbp",
  "project_id",
  "invoice_id",
] as const;

/** Every invoice and credit note issued in the range (drafts never; void ones listed, counting nothing). */
export function accountsInvoicesCsv(input: AccountsInput): string {
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  const then = asOf(input, input.to);
  const rows = input.invoices
    .filter((i) => i.status !== "draft" && inRange(issuedOn(i), input))
    .sort((a, b) => issuedOn(a).localeCompare(issuedOn(b)) || a.number.localeCompare(b.number))
    .map((inv) => {
      const p = projects.get(inv.projectId);
      const credit = inv.kind === "credit-note";
      const tax = taxOf(inv);
      const mine = then.get(inv.projectId) ?? [];
      const asThen = mine.find((i) => i.id === inv.id);
      const target = inv.creditsInvoiceId ? input.invoices.find((t) => t.id === inv.creditsInvoiceId) : undefined;
      // What was still owed on it then, within its project (account credit and credit notes come off).
      const owedThen = asThen && !credit ? invoiceOutstanding(asThen, mine) : 0;
      return [
        credit ? "Credit note" : "Invoice",
        inv.number,
        issuedOn(inv),
        credit ? "" : (inv.dueOn ?? "").slice(0, 10),
        INVOICE_KIND_LABEL[inv.kind] ?? inv.kind,
        p?.ref ?? "",
        p?.customerRef ?? "",
        p?.customerName ?? "",
        input.vatRegistered ? poundsCell(inv.netPence) : "",
        input.vatRegistered ? poundsCell(inv.taxPence) : "",
        poundsCell(inv.totalPence),
        tax.code,
        input.vatRegistered ? tax.ratePct : "",
        target?.number ?? "",
        credit ? (creditPurposeOf(inv) ?? "") : "",
        (credit || inv.kind === "cancellation-charge" ? inv.reason : undefined) ?? inv.lines.map((l) => l.label).join("; "),
        inv.status,
        asThen ? poundsCell(asThen.paidPence) : poundsCell(0),
        poundsCell(owedThen),
        p?.cancelled ? "yes" : "no",
        poundsCell(revenueNet(inv, input.invoices.filter((i) => i.projectId === inv.projectId), p?.cancelled ?? false)),
        inv.projectId,
        inv.id,
      ];
    });
  return toCsv([...INVOICE_COLUMNS], rows);
}

export const PAYMENT_COLUMNS = [
  "type",
  "date",
  "method",
  "provider",
  "provider_ref",
  "customer_reference",
  "invoice_number",
  "project_ref",
  "customer_ref",
  "customer_name",
  "amount_gbp",
  "status",
  "counted",
  "recorded_by",
  "note",
  "project_id",
  "payment_id",
] as const;

/** Every payment and refund dated in the range: card and bank transfer alike, failed and DEMO ones listed but not counted. */
export function accountsPaymentsCsv(input: AccountsInput): string {
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  const invoices = new Map(input.invoices.map((i) => [i.id, i]));
  const rows = input.payments
    .filter((p) => inRange(londonDayOf(p.receivedAt), input))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.providerRef.localeCompare(b.providerRef))
    .map((pay) => {
      const p = projects.get(pay.projectId);
      const refund = pay.amountPence < 0 || pay.status === "refunded";
      return [
        refund ? "Refund" : "Payment",
        londonDayOf(pay.receivedAt),
        METHOD[pay.method] ?? pay.method,
        PROVIDER[pay.provider] ?? pay.provider,
        pay.providerRef,
        pay.reference ?? "",
        pay.invoiceId ? (invoices.get(pay.invoiceId)?.number ?? "") : "",
        p?.ref ?? "",
        p?.customerRef ?? "",
        p?.customerName ?? "",
        poundsCell(pay.amountPence),
        pay.status,
        counted(pay) ? "yes" : "no",
        pay.recordedBy ?? (pay.provider === "stripe" ? "Stripe" : ""),
        pay.note ?? "",
        pay.projectId,
        pay.id,
      ];
    });
  return toCsv([...PAYMENT_COLUMNS], rows);
}

export interface AccountsSummaryRow {
  line: string;
  count?: number;
  totalPence?: number;
  netPence?: number;
  vatPence?: number;
  note?: string;
}

/** The totals an accountant reconciles against the two lists and the bank. */
export function accountsSummary(input: AccountsInput): AccountsSummaryRow[] {
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  const inRangeInvoices = input.invoices.filter((i) => live(i) && inRange(issuedOn(i), input));
  const sumOf = (list: Invoice[]) => ({
    count: list.length,
    totalPence: list.reduce((s, i) => s + i.totalPence, 0),
    netPence: list.reduce((s, i) => s + i.netPence, 0),
    vatPence: list.reduce((s, i) => s + i.taxPence, 0),
  });
  const issued = sumOf(inRangeInvoices.filter((i) => i.kind !== "credit-note"));
  const credited = sumOf(inRangeInvoices.filter((i) => i.kind === "credit-note"));
  const revenue = inRangeInvoices.reduce(
    (s, i) => s + revenueNet(i, input.invoices.filter((x) => x.projectId === i.projectId), projects.get(i.projectId)?.cancelled ?? false),
    0,
  );
  const pays = input.payments.filter((p) => inRange(londonDayOf(p.receivedAt), input));
  const received = pays.filter((p) => counted(p) && p.amountPence > 0);
  const refunded = pays.filter((p) => counted(p) && p.amountPence < 0);
  const byMethod = (list: Payment[], method: Payment["method"][]) => list.filter((p) => method.includes(p.method));
  const total = (list: Payment[]) => list.reduce((s, p) => s + p.amountPence, 0);
  const notCounted = pays.filter((p) => !counted(p));

  let owed = 0;
  let credit = 0;
  for (const list of asOf(input, input.to).values()) {
    const balance = outstandingPence(list);
    if (balance > 0) owed += balance;
    else credit -= balance;
  }
  const vat = (n?: number) => (input.vatRegistered ? n : undefined);
  const rows: AccountsSummaryRow[] = [
    { line: `Period: ${input.from} to ${input.to} (London dates, both included)` },
    { line: "Invoices issued", count: issued.count, totalPence: issued.totalPence, netPence: vat(issued.netPence), vatPence: vat(issued.vatPence) },
    { line: "Credit notes issued", count: credited.count, totalPence: credited.totalPence, netPence: vat(credited.netPence), vatPence: vat(credited.vatPence) },
    {
      line: "Net invoiced (invoices less credit notes)",
      totalPence: issued.totalPence + credited.totalPence,
      netPence: vat(issued.netPence + credited.netPence),
      vatPence: vat(issued.vatPence + credited.vatPence),
    },
    {
      line: "Revenue, net of VAT",
      netPence: revenue,
      note: "Cancelled contracts are never revenue (as the contract stands now); a charge for work done before a cancellation is.",
    },
    { line: "Received by card", count: byMethod(received, ["card"]).length, totalPence: total(byMethod(received, ["card"])) },
    { line: "Received by bank transfer", count: byMethod(received, ["bank-transfer"]).length, totalPence: total(byMethod(received, ["bank-transfer"])) },
    { line: "Received another way (cash, other)", count: byMethod(received, ["cash", "other"]).length, totalPence: total(byMethod(received, ["cash", "other"])) },
    { line: "Received in total", count: received.length, totalPence: total(received) },
    { line: "Refunded by card", count: byMethod(refunded, ["card"]).length, totalPence: total(byMethod(refunded, ["card"])) },
    { line: "Refunded by bank transfer", count: byMethod(refunded, ["bank-transfer"]).length, totalPence: total(byMethod(refunded, ["bank-transfer"])) },
    { line: "Refunded another way (cash, other)", count: byMethod(refunded, ["cash", "other"]).length, totalPence: total(byMethod(refunded, ["cash", "other"])) },
    { line: "Refunded in total", count: refunded.length, totalPence: total(refunded) },
    { line: "Net received (received less refunded)", totalPence: total(received) + total(refunded) },
    { line: `Owed to us at the end of ${input.to}`, totalPence: owed, note: "What customers still owed on everything issued by then, after payments, refunds and credit notes by then." },
    { line: `Customers in credit at the end of ${input.to}`, totalPence: credit, note: "Paid more than they owed then (to refund, or to come off a later invoice)." },
  ];
  if (notCounted.length) {
    rows.push({
      line: "Listed but not counted (pending, failed, or DEMO)",
      count: notCounted.length,
      totalPence: total(notCounted),
      note: "In the payments file with counted = no.",
    });
  }
  return rows;
}

export const SUMMARY_COLUMNS = ["line", "count", "total_gbp", "net_gbp", "vat_gbp", "note"] as const;

export function accountsSummaryCsv(input: AccountsInput): string {
  return toCsv(
    [...SUMMARY_COLUMNS],
    accountsSummary(input).map((r) => [
      r.line,
      r.count ?? "",
      r.totalPence === undefined ? "" : poundsCell(r.totalPence),
      r.netPence === undefined ? "" : poundsCell(r.netPence),
      r.vatPence === undefined ? "" : poundsCell(r.vatPence),
      r.note ?? "",
    ]),
  );
}
