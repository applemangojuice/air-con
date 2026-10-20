import { accountsInvoicesCsv, accountsPaymentsCsv, accountsSummary, accountsSummaryCsv, projectShortId, type AccountsInput, type AccountsProject } from "@aircon/domain";
import { loadAllProjects } from "./ops-core-server";
import * as invoicesRepo from "./repo/invoices";
import * as paymentsRepo from "./repo/payments";
import { getSettings } from "./settings-server";

/**
 * The accountant's export (§K45; admins only, `finance.export`): the rows
 * the pure `accounts.ts` turns into CSV, for every project. Money is only
 * what the books hold: invoices, credit notes and payment records.
 */

export type AccountsFile = "invoices" | "payments" | "summary";
export const ACCOUNTS_FILES: readonly AccountsFile[] = ["invoices", "payments", "summary"];

/** Every project the books mention, with the references an accountant matches on. */
async function accountsProjects(): Promise<AccountsProject[]> {
  return (await loadAllProjects(100_000)).map(({ project: p }) => ({
    id: p.id,
    ref: p.pilot ? `Pilot ${p.pilot.number}` : `P-${projectShortId(p.id)}`,
    customerRef: p.customer.customerId ? `C-${projectShortId(p.customer.customerId)}` : "",
    customerName: p.customer.name,
    cancelled: Boolean(p.cancellation) || (p.closure.closed && p.closure.reason === "cancelled"),
  }));
}

export async function loadAccounts(from: string, to: string): Promise<AccountsInput> {
  const [invoices, payments, projects, settings] = await Promise.all([invoicesRepo.listAll(), paymentsRepo.listAll(), accountsProjects(), getSettings()]);
  return { from, to, invoices, payments, projects, vatRegistered: settings.tax.vatRegistered };
}

export function accountsFile(input: AccountsInput, file: AccountsFile): string {
  if (file === "invoices") return accountsInvoicesCsv(input);
  if (file === "payments") return accountsPaymentsCsv(input);
  return accountsSummaryCsv(input);
}

export { accountsSummary };
