import type { Metadata } from "next";
import { accountsRangeProblem } from "@aircon/domain";
import { Card, LinkButton, PageHeader, Section } from "@/components/kit";
import { accountsSummary, loadAccounts } from "@/lib/accounts-server";
import { requireStaff } from "@/lib/auth/server";
import { money } from "@/lib/format";
import { londonToday } from "@/lib/project-service";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = { title: "Money: for the accountant · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const field = "min-h-12 w-full rounded-full border border-line bg-white px-4 text-base text-ink-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
const label = "mb-1.5 block text-sm font-semibold text-ink-900";

/** yyyy-mm-dd helpers on London dates. */
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
function lastMonth(today: string): { from: string; to: string } {
  const d = new Date(`${monthStart(today)}T12:00:00Z`);
  d.setUTCDate(0); // the last day of the month before
  const to = d.toISOString().slice(0, 10);
  return { from: monthStart(to), to };
}
/** The UK tax year so far: from 6 April. */
function taxYear(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const start = today >= `${y}-04-06` ? `${y}-04-06` : `${y - 1}-04-06`;
  return { from: start, to: today };
}

/**
 * Money across every project, for the accountant (§K45; admins only,
 * `finance.export`): pick London dates, see the totals that reconcile, and
 * download every invoice and credit note, every payment and refund, and the
 * summary, as CSV. Cancelled contracts are never revenue.
 */
export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff("finance.export");
  const sp = await searchParams;
  const today = londonToday();
  const from = typeof sp.from === "string" ? sp.from : monthStart(today);
  const to = typeof sp.to === "string" ? sp.to : today;
  const problem = accountsRangeProblem(from, to);
  const rows = !problem && getServiceClient() ? accountsSummary(await loadAccounts(from, to)) : [];
  const qs = (file: string) => `/ops/money/export?file=${file}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const quick = [
    { label: "This month", ...{ from: monthStart(today), to: today } },
    { label: "Last month", ...lastMonth(today) },
    { label: "Tax year so far", ...taxYear(today) },
  ];

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Money"
        title="For the accountant"
        subtitle="Every invoice, credit note, payment and refund across all projects, for the dates you pick (London dates, both included). Cancelled contracts are never revenue; a charge for work done before a cancellation is."
      />

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className={label}>
            From
            <input type="date" name="from" defaultValue={from} required className={`${field} mt-1.5 font-normal`} />
          </label>
          <label className={label}>
            To (included)
            <input type="date" name="to" defaultValue={to} required className={`${field} mt-1.5 font-normal`} />
          </label>
          <button type="submit" className="inline-flex min-h-12 items-center justify-center rounded-full bg-ink-900 px-6 font-semibold text-white">
            Show
          </button>
        </form>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {quick.map((q) => (
            <a key={q.label} href={`/ops/money?from=${q.from}&to=${q.to}`} className="font-semibold text-accent-700 underline">
              {q.label}
            </a>
          ))}
        </p>
        {problem && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-700">
            {problem}
          </p>
        )}
      </Card>

      {!problem && (
        <>
          <Section className="mt-8" title={`Totals, ${from} to ${to}`} description="They reconcile with the files below, to the penny.">
            <Card padded={false}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-ink-500">
                      <th className="px-4 py-2 font-semibold">Line</th>
                      <th className="px-4 py-2 text-right font-semibold">Count</th>
                      <th className="px-4 py-2 text-right font-semibold">Total</th>
                      <th className="px-4 py-2 text-right font-semibold">Net</th>
                      <th className="px-4 py-2 text-right font-semibold">VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.line} className="border-b border-line align-top last:border-0">
                        <th scope="row" className="px-4 py-2 text-left font-medium text-ink-900">
                          {r.line}
                          {r.note && <span className="block text-xs font-normal text-ink-500">{r.note}</span>}
                        </th>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-700">{r.count ?? ""}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-900">{r.totalPence === undefined ? "" : money(r.totalPence)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-700">{r.netPence === undefined ? "" : money(r.netPence)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-700">{r.vatPence === undefined ? "" : money(r.vatPence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Section>

          <Section className="mt-8" title="Download for the accountant" description="CSV, opens in Excel, Numbers or Google Sheets. Amounts in pounds; refunds and credit notes are negative.">
            <div className="flex flex-wrap gap-3">
              <LinkButton href={qs("invoices")} prefetch={false}>
                Invoices and credit notes
              </LinkButton>
              <LinkButton href={qs("payments")} variant="secondary" prefetch={false}>
                Payments and refunds
              </LinkButton>
              <LinkButton href={qs("summary")} variant="secondary" prefetch={false}>
                Summary
              </LinkButton>
            </div>
            <p className="mt-3 text-sm text-ink-500">
              Each file says, for every row, the project and customer reference, the tax code (and the VAT, when you&apos;re registered), the status and the
              payment provider&apos;s reference. Payments that are DEMO, pending or failed are listed with counted = no and left out of the totals.
            </p>
          </Section>
        </>
      )}
    </main>
  );
}
