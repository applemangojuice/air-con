import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { INVOICE_KIND_LABEL, invoiceOutstanding, isInvoiceOverdue, type Invoice, type Payment } from "@aircon/domain";
import { Badge, Card, EmptyState, Money, Section, Stat, StatusChip } from "@/components/kit";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { fmtDate } from "@/lib/format";
import { loadMoney, type InvoicePlan } from "@/lib/money-server";
import { isUuid } from "@/lib/repo/base";
import { ActionForm } from "../booking/_f5/action-form";
import { JobHeader } from "../booking/_f5/job-header";
import { creditAction, finishAction, issueAction, paymentAction, refundAction } from "./actions";

export const metadata: Metadata = { title: "Money · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const field = "min-h-12 w-full rounded-full border border-line bg-white px-4 text-base text-ink-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
const label = "mb-1.5 block text-sm font-semibold text-ink-900";

const METHOD_LABEL: Record<Payment["method"], string> = { "bank-transfer": "Bank transfer", card: "Card", cash: "Cash", other: "Other" };
const PLAN_ORDER = ["deposit", "balance", "variation", "survey-fee", "change-fee"] as const;

/**
 * Money (payments.record): what's been invoiced and paid, new invoices
 * (each issued from the figure shown here, then emailed), payments recorded
 * by the person who saw the money, refunds and credit notes. Nothing is
 * paid without a payment record.
 */
export default async function MoneyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff("payments.record");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const access = await requireProjectAccess(id, { perm: "payments.record" });
  if (!access || access.kind !== "staff") notFound();
  const view = await loadMoney(id);
  if (!view) notFound();
  const { project: p, summary: s, invoices, payments, settings } = view;
  const docFor = (docId?: string) => (docId ? view.documents.find((d) => d.id === docId) : undefined);
  const receiptFor = (paymentId: string) =>
    view.documents.find((d) => d.kind === "receipt" && (d.snapshot as { payment?: { id?: string } } | null)?.payment?.id === paymentId);
  const live = invoices.filter((i) => i.status !== "void" && i.status !== "draft");
  const available = PLAN_ORDER.map((k) => view.plans[k]).filter((pl) => pl.available);
  const unavailable = PLAN_ORDER.map((k) => view.plans[k]).filter((pl) => !pl.available);
  const card = view.card;

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-8 sm:px-6">
      <JobHeader project={p} current="money" title="Money" subtitle="Invoices, payments and receipts. Nothing is marked paid until the money is seen." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Contract" value={s.contractTotalPence !== null ? <Money pence={s.contractTotalPence} /> : "Not accepted"} hint={s.toInvoicePence ? <>Still to invoice: <Money pence={s.toInvoicePence} /></> : undefined} />
        <Stat label="Invoiced" value={<Money pence={s.invoicedPence} />} hint={`${live.length} invoice${live.length === 1 ? "" : "s"}`} />
        <Stat label="Received" value={<Money pence={s.receivedPence - s.refundedPence} />} tone={s.receivedPence > 0 ? "success" : "neutral"} hint={s.refundedPence ? <>After <Money pence={s.refundedPence} /> refunded</> : "Verified payments only"} />
        <Stat
          label={s.outstandingPence < 0 ? "In credit" : "Outstanding"}
          value={<Money pence={Math.abs(s.outstandingPence)} />}
          tone={s.outstandingPence > 0 ? "warn" : "success"}
          hint={s.outstandingPence < 0 ? "Overpaid: refund or credit it" : undefined}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <span>How customers can pay:</span>
        {settings.company.bank ? <Badge tone="success">Bank transfer</Badge> : <Badge tone="warn">No bank details in settings</Badge>}
        {card.available ? (
          <Badge tone={card.mode === "test" ? "warn" : "success"}>{card.mode === "test" ? "Card (Stripe TEST MODE)" : "Card (Stripe)"}</Badge>
        ) : card.simulate ? (
          <Badge tone="warn">Card: DEMO simulator only</Badge>
        ) : (
          <Badge tone="neutral">Card not set up</Badge>
        )}
        <Link href={`/p/${p.id}/pay`} className="font-semibold text-accent-700 underline">
          See the customer&apos;s payment page
        </Link>
      </div>
      {!settings.company.bank && (
        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Add the bank account in <Link className="font-semibold underline" href="/ops/settings">Settings</Link> so invoices and the payment page can show it. Until then customers are asked to call.
        </p>
      )}

      {/* Invoices */}
      <Section className="mt-8" title="Invoices">
        {live.length === 0 ? (
          <EmptyState title="No invoices yet" body={available.length ? "Raise one below: it's numbered, emailed and in the customer's documents." : "Invoices open up once the proposal is accepted."} />
        ) : (
          <ul className="space-y-3">
            {live.map((inv) => (
              <InvoiceRow key={inv.id} inv={inv} all={invoices} today={view.today} doc={docFor(inv.documentId)} projectId={p.id} />
            ))}
          </ul>
        )}
      </Section>

      {/* New invoice */}
      <Section className="mt-10" title="New invoice" description="Each one is issued at the figure shown, numbered from settings, emailed, and put in the customer's documents.">
        {available.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-500">Nothing to invoice right now.</p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {available.map((plan) => (
              <PlanCard key={plan.kind} plan={plan} projectId={p.id} />
            ))}
          </div>
        )}
        {unavailable.length > 0 && (
          <details className="mt-3 rounded-2xl border border-line bg-white px-4">
            <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-ink-900">Why the others aren&apos;t available</summary>
            <ul className="space-y-1.5 pb-4 text-sm text-ink-700">
              {unavailable.map((pl) => (
                <li key={pl.kind}>
                  <span className="font-semibold text-ink-900">{INVOICE_KIND_LABEL[pl.kind]}:</span> {pl.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        <details className="mt-3 rounded-2xl border border-line bg-white px-4">
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-ink-900">A credit note not tied to one invoice</summary>
          <div className="pb-4">
            <ActionForm action={creditAction.bind(null, p.id)} submitLabel="Issue credit note" variant="secondary" confirm="Issue this credit note? It goes in the customer's documents.">
              <CreditFields />
            </ActionForm>
          </div>
        </details>
      </Section>

      {/* Payments */}
      <Section className="mt-10" title="Payments" description="Every one has a record: who saw it, when it arrived, and its reference.">
        {payments.length === 0 ? (
          <EmptyState title="No payments yet" body="Record a bank transfer from an invoice above once you've seen it in the account. Card payments appear here by themselves once Stripe confirms them." />
        ) : (
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {[...payments].reverse().map((pay) => {
                const inv = invoices.find((i) => i.id === pay.invoiceId);
                const receipt = receiptFor(pay.id);
                return (
                  <li key={pay.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900">
                        <Money pence={pay.amountPence} /> {pay.amountPence < 0 ? "refunded" : "received"}
                        {inv ? ` · ${inv.number}` : ""}
                      </p>
                      <p className="text-sm text-ink-500">
                        {fmtDate(pay.receivedAt)} · {METHOD_LABEL[pay.method]}
                        {pay.reference ? ` · ref ${pay.reference}` : ""}
                        {pay.recordedBy ? ` · recorded by ${pay.recordedBy}` : pay.provider === "stripe" ? " · confirmed by Stripe" : ""}
                      </p>
                      {pay.note && <p className="text-sm text-ink-700">{pay.note}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {pay.provider === "demo" && <Badge tone="warn">DEMO: no money moved</Badge>}
                      {pay.provider === "stripe" && <Badge tone="info">Stripe</Badge>}
                      <StatusChip status={pay.status} />
                      {!pay.appliedAt && <Badge tone="warn">Not fully applied: reload in a minute</Badge>}
                      {receipt && (
                        <Link href={`/d/${receipt.id}`} className="text-sm font-semibold text-accent-700 underline">
                          Receipt
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Section>
    </main>
  );
}

function PlanCard({ plan, projectId }: { plan: InvoicePlan; projectId: string }) {
  if (plan.kind === "variation") {
    return (
      <Card>
        <h3 className="font-semibold text-ink-900">Variation</h3>
        <p className="mt-1 text-sm text-ink-500">Bill an accepted variation on its own (otherwise the balance invoice includes it).</p>
        <ActionForm action={issueAction.bind(null, projectId)} submitLabel="Issue and email" confirm="Issue this variation invoice and email it to the customer?">
          <input type="hidden" name="kind" value="variation" />
          <fieldset className="mt-3">
            <legend className={label}>Which variation</legend>
            {(plan.variations ?? []).map((v) => (
              <label key={v.id} className="flex min-h-11 items-center gap-2 text-sm text-ink-900">
                <input type="radio" name="issueId" value={v.id} required className="h-4 w-4 accent-accent-600" />
                #{v.number} {v.title}: <Money pence={v.totalPence} signed />
              </label>
            ))}
          </fieldset>
        </ActionForm>
      </Card>
    );
  }
  return (
    <Card>
      <h3 className="font-semibold text-ink-900">{INVOICE_KIND_LABEL[plan.kind]}</h3>
      <dl className="mt-3 space-y-1.5 text-sm">
        {plan.lines.map((l, i) => (
          <div key={`${l.label}-${i}`} className="flex justify-between gap-3">
            <dt className="text-ink-700">{l.label}</dt>
            <dd className="tabular-nums text-ink-900">
              <Money pence={l.totalPence} />
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold">
          <dt>Total</dt>
          <dd>
            <Money pence={plan.totalPence} />
          </dd>
        </div>
      </dl>
      <ActionForm action={issueAction.bind(null, projectId)} submitLabel="Issue and email" busyLabel="Issuing…" confirm={`Issue this ${INVOICE_KIND_LABEL[plan.kind].toLowerCase()} invoice and email it to the customer?`}>
        <input type="hidden" name="kind" value={plan.kind} />
        <input type="hidden" name="expectedTotal" value={(plan.totalPence / 100).toFixed(2)} />
      </ActionForm>
    </Card>
  );
}

function CreditFields({ max }: { max?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={label}>
          Amount (£)
          <input name="amount" inputMode="decimal" required defaultValue={max ? (max / 100).toFixed(2) : ""} className={`${field} mt-1.5 font-normal`} />
        </label>
      </div>
      <div>
        <label className={label}>
          Reason (printed on it)
          <input name="reason" required maxLength={300} className={`${field} mt-1.5 font-normal`} />
        </label>
      </div>
    </div>
  );
}

function InvoiceRow({
  inv,
  all,
  today,
  doc,
  projectId,
}: {
  inv: Invoice;
  all: Invoice[];
  today: string;
  doc?: { id: string; ref: string };
  projectId: string;
}) {
  const owed = invoiceOutstanding(inv, all);
  const overdue = isInvoiceOverdue(inv, all, today);
  const credit = inv.kind === "credit-note";
  const credited = all.filter((c) => c.kind === "credit-note" && c.creditsInvoiceId === inv.id && c.status !== "void");
  const unfinished = !inv.documentId || !inv.recordedOnProjectAt;
  const todayIso = today;

  return (
    <Card as="li" padded={false}>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0">
          <p className="font-semibold text-ink-900">
            {inv.number} · {INVOICE_KIND_LABEL[inv.kind]}
          </p>
          <p className="text-sm text-ink-500">
            Issued {inv.issuedAt ? fmtDate(inv.issuedAt) : "—"}
            {inv.dueOn && !credit ? ` · due ${fmtDate(inv.dueOn)}` : ""}
            {inv.issuedBy ? ` · by ${inv.issuedBy}` : ""}
          </p>
          {inv.reason && <p className="text-sm text-ink-700">{inv.reason}</p>}
          {credited.length > 0 && <p className="text-sm text-ink-700">Credited: {credited.map((c) => c.number).join(", ")}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="text-lg font-semibold tabular-nums text-ink-900">
            <Money pence={inv.totalPence} />
          </span>
          {overdue && <Badge tone="danger">Overdue</Badge>}
          <StatusChip status={credit ? "issued" : owed === 0 && inv.paidPence < inv.totalPence ? "closed" : inv.status} label={credit ? "Credit note" : owed === 0 && inv.paidPence < inv.totalPence ? "Credited" : undefined} />
          {doc ? (
            <Link href={`/d/${doc.id}`} className="text-sm font-semibold text-accent-700 underline">
              Document
            </Link>
          ) : null}
        </div>
      </div>
      {!credit && (inv.paidPence !== 0 || owed > 0) && (
        <p className="px-5 pb-3 text-sm text-ink-700 sm:px-6">
          Paid <Money pence={inv.paidPence} /> · left to pay <Money pence={owed} className="font-semibold" />
        </p>
      )}
      {unfinished && (
        <div className="mx-5 mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:mx-6">
          Issuing didn&apos;t finish ({!inv.documentId ? "no printable document" : "the project's totals weren't updated"}).
          <ActionForm action={finishAction.bind(null, projectId)} submitLabel="Finish issuing" variant="secondary">
            <input type="hidden" name="invoiceId" value={inv.id} />
          </ActionForm>
        </div>
      )}
      {!credit && (owed > 0 || inv.paidPence > 0) && (
        <div className="space-y-2 border-t border-line bg-surface/40 px-5 py-3 sm:px-6">
          {owed > 0 && (
            <details className="rounded-2xl border border-line bg-white px-4" open={false}>
              <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-ink-900">Record a payment you&apos;ve seen</summary>
              <div className="pb-4">
                <ActionForm action={paymentAction.bind(null, projectId)} submitLabel="Record the payment" busyLabel="Recording…" resetOnSuccess>
                  <input type="hidden" name="invoiceId" value={inv.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={label} htmlFor={`amt-${inv.id}`}>Amount (£)</label>
                      <input id={`amt-${inv.id}`} name="amount" inputMode="decimal" required defaultValue={(owed / 100).toFixed(2)} className={field} />
                    </div>
                    <div>
                      <label className={label} htmlFor={`on-${inv.id}`}>Date it arrived</label>
                      <input id={`on-${inv.id}`} name="receivedOn" type="date" required max={todayIso} defaultValue={todayIso} className={field} />
                    </div>
                    <div>
                      <label className={label} htmlFor={`m-${inv.id}`}>How</label>
                      <select id={`m-${inv.id}`} name="method" defaultValue="bank-transfer" className={`${field} pr-10`}>
                        <option value="bank-transfer">Bank transfer</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card (taken elsewhere)</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className={label} htmlFor={`ref-${inv.id}`}>Reference on the statement</label>
                      <input id={`ref-${inv.id}`} name="reference" maxLength={120} placeholder={inv.number} className={field} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={label} htmlFor={`pn-${inv.id}`}>Note (optional)</label>
                      <input id={`pn-${inv.id}`} name="note" maxLength={500} className={field} />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-ink-500">Only record money you&apos;ve seen arrive. The customer gets a receipt by email.</p>
                </ActionForm>
              </div>
            </details>
          )}
          {owed > 0 && (
            <details className="rounded-2xl border border-line bg-white px-4">
              <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-ink-900">Credit it (cancel what&apos;s unpaid)</summary>
              <div className="pb-4">
                <ActionForm action={creditAction.bind(null, projectId)} submitLabel="Issue credit note" variant="secondary" confirm={`Issue a credit note against ${inv.number}?`}>
                  <input type="hidden" name="invoiceId" value={inv.id} />
                  <CreditFields max={owed} />
                </ActionForm>
              </div>
            </details>
          )}
          {inv.paidPence > 0 && (
            <details className="rounded-2xl border border-line bg-white px-4">
              <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold text-ink-900">Record a refund</summary>
              <div className="pb-4">
                <ActionForm action={refundAction.bind(null, projectId)} submitLabel="Record the refund" variant="secondary" confirm="Record this refund? It's shown to the customer on their timeline." resetOnSuccess>
                  <input type="hidden" name="invoiceId" value={inv.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={label} htmlFor={`ra-${inv.id}`}>Amount refunded (£)</label>
                      <input id={`ra-${inv.id}`} name="amount" inputMode="decimal" required className={field} />
                    </div>
                    <div>
                      <label className={label} htmlFor={`ro-${inv.id}`}>Date sent</label>
                      <input id={`ro-${inv.id}`} name="refundedOn" type="date" required max={todayIso} defaultValue={todayIso} className={field} />
                    </div>
                    <div>
                      <label className={label} htmlFor={`rm-${inv.id}`}>How</label>
                      <select id={`rm-${inv.id}`} name="method" defaultValue="bank-transfer" className={`${field} pr-10`}>
                        <option value="bank-transfer">Bank transfer</option>
                        <option value="card">Card refund</option>
                        <option value="cash">Cash</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className={label} htmlFor={`rr-${inv.id}`}>Reason</label>
                      <input id={`rr-${inv.id}`} name="reason" required maxLength={300} className={field} />
                    </div>
                  </div>
                </ActionForm>
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
