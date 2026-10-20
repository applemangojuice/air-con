import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { INVOICE_KIND_LABEL, isInvoiceOverdue, type Invoice } from "@aircon/domain";
import { Badge, LinkButton } from "@/components/kit";
import { Logo } from "@/components/site/logo";
import { getSession, requireProjectAccess } from "@/lib/auth/server";
import { listDocuments } from "@/lib/documents-server";
import { fmtDate, money } from "@/lib/format";
import { cardAvailability, payableInvoices, recordStripePayment } from "@/lib/money-server";
import { londonToday, loadProject } from "@/lib/project-service";
import { retrieveCheckoutSession } from "@/lib/providers/stripe";
import { isUuid } from "@/lib/repo/base";
import * as invoicesRepo from "@/lib/repo/invoices";
import * as paymentsRepo from "@/lib/repo/payments";
import { getSettings } from "@/lib/settings-server";
import { factsFromSession } from "../../../api/stripe/webhook/stripe-events";
import { ActionForm } from "../../../ops/projects/[id]/booking/_f5/action-form";
import { FlashRegion } from "../../../ops/projects/[id]/booking/_f5/flash";
import { CopyButton } from "./copy-button";
import { payHeadline } from "./headline";
import { sentTransferAction, simulatePaymentAction } from "./actions";
import { reachUs, realPhone } from "@/components/site/claims";
import { cancelledAfterEarlyWork } from "@/components/portal/view";

export const metadata: Metadata = { title: "Your payments", robots: { index: false } };
export const dynamic = "force-dynamic";

const CARD_NOTICE: Record<string, string> = {
  cancelled: "Card payment cancelled. Nothing was taken.",
  unavailable: "Card payment isn't available right now. Bank transfer works, or call us.",
  failed: "We couldn't open the card payment page just now. Try again in a minute, or pay by bank transfer.",
  "nothing-due": "There's nothing left to pay on that invoice.",
  "not-payable": "That invoice can't be paid online.",
  "cancelled-contract": "Your contract is cancelled, so there's nothing to pay.",
};

/**
 * The customer's payment page (mobile first): what's owed, by when, and how
 * to pay. Bank transfer whenever settings hold the account (no fees, best
 * for larger amounts); card when Stripe is set up (TEST MODE says so); in
 * demo mode a labelled simulator. Coming back from card checkout says "we'll
 * confirm once it's received" until Stripe itself confirms the payment.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const session = await getSession();
  if (!session) return <SignIn projectId={id} />;
  const access = await requireProjectAccess(id, { allowCustomer: true, customerSide: true });
  if (!access) notFound();
  const project = await loadProject(id);
  if (!project) notFound();

  // Back from Stripe: ask Stripe (never the redirect) whether it's paid, and record it if so.
  let returned: "confirmed" | "pending" | null = null;
  const sessionId = typeof sp.session === "string" ? sp.session : undefined;
  if (sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    returned = "pending";
    const card = await cardAvailability();
    if (card.available) {
      const s = await retrieveCheckoutSession(sessionId);
      if (s.ok && s.value.metadata?.project_id === id) {
        const facts = factsFromSession(s.value, new Date().toISOString());
        if (facts) {
          const recorded = await recordStripePayment(facts).catch((err) => {
            console.error("[pay] recording a returned session failed:", err);
            return null;
          });
          if (recorded?.ok) returned = "confirmed";
        }
      }
    }
  }

  const [settings, invoices, payments, documents] = await Promise.all([
    getSettings(),
    invoicesRepo.listForProject(id),
    paymentsRepo.listForProject(id),
    listDocuments(id, { customerVisibleOnly: true }),
  ]);
  const today = londonToday();
  // A cancelled contract asks for nothing (reg 34): what's paid is refunded, nothing more is due.
  const cancelled = project.closure.reason === "cancelled";
  const payable = cancelled ? [] : payableInvoices(invoices);
  const settled = invoices.filter((i) => (i.status === "paid" || i.status === "part-paid") && !payable.some((p) => p.id === i.id));
  const card = await cardAvailability();
  const bank = settings.payments.methods.includes("bank-transfer") ? settings.company.bank : undefined;
  const cardOn = card.available && settings.payments.methods.includes("card");
  const docOf = (docId?: string) => (docId ? documents.find((d) => d.id === docId) : undefined);
  const receiptOf = (invoiceId: string) =>
    documents.filter((d) => d.kind === "receipt" && (d.snapshot as { invoice?: { id?: string } } | null)?.invoice?.id === invoiceId);
  const first = (project.customer.name || "").replace(/^DEMO\s+/, "").split(/\s+/)[0] || "there";
  const notice = typeof sp.card === "string" ? CARD_NOTICE[sp.card] : undefined;
  const totalOwed = payable.reduce((s, i) => s + i.owedPence, 0);
  const headline = payHeadline({
    first,
    cancelled,
    payableCount: payable.length,
    paidSomething: invoices.some((i) => i.paidPence > 0),
    ...(project.cancellation ? { cancellation: project.cancellation } : {}),
    workedEarly: cancelledAfterEarlyWork(project),
  });

  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line bg-cream/90">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4">
          <Link href="/" aria-label="Dang, It's Hot home">
            <Logo />
          </Link>
          <Link href={`/p/${id}`} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-ink-700 hover:bg-surface">
            Your project
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-2xl px-4 pb-24 pt-8">
        <p className="text-sm font-semibold text-ink-500">
          {project.customer.addressLine}
          {project.customer.postcode ? `, ${project.customer.postcode}` : ""}
        </p>
        <h1 className="mt-1 font-display text-3xl leading-tight text-ink-900 sm:text-4xl">
          {headline.title}
        </h1>

        <div aria-live="polite">
          {returned === "confirmed" && (
            <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 font-medium text-emerald-900">
              Payment received. Thank you. Your receipt is below, and on its way by email.
            </p>
          )}
          {returned === "pending" && (
            <p className="mt-5 rounded-2xl border border-sage-200 bg-sage-50 px-4 py-3 font-medium text-sage-900">
              Thanks. We&apos;ll confirm here and by email once your card payment is received. That&apos;s usually within a few minutes.
            </p>
          )}
          {notice && <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 font-medium text-amber-900">{notice}</p>}
        </div>

        {payable.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-line bg-white p-5">
            {/* A cancellation's wording (inside the period or after it) is payHeadline's: one rule with the hub and the email. */}
            <p className="text-ink-900">{headline.nothingDue}</p>
            <LinkButton href={`/p/${id}`} variant="secondary" className="mt-4">
              Back to your project
            </LinkButton>
          </section>
        ) : (
          <>
            {payable.length > 1 && (
              <p className="mt-3 text-ink-700">
                {payable.length} invoices, <span className="font-semibold text-ink-900">{formatMoney(totalOwed)}</span> in total.
              </p>
            )}
            <ol className="mt-6 space-y-6">
              {payable.map((inv) => (
                <InvoiceCard
                  key={inv.id}
                  inv={inv}
                  overdue={isInvoiceOverdue(inv, invoices, today)}
                  doc={docOf(inv.documentId)}
                  bank={bank}
                  cardOn={cardOn}
                  testMode={card.mode === "test"}
                  simulate={card.simulate}
                  projectId={id}
                  reach={reachUs(settings.company)}
                />
              ))}
            </ol>
          </>
        )}

        {settled.length > 0 && (
          <section className="mt-10" aria-labelledby="paid-heading">
            <h2 id="paid-heading" className="font-display text-xl text-ink-900">
              Paid
            </h2>
            <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white">
              {settled.map((inv) => {
                const receipts = receiptOf(inv.id);
                const paidOn = payments.filter((p) => p.invoiceId === inv.id && p.status === "succeeded").at(-1)?.receivedAt;
                return (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900">
                        {INVOICE_KIND_LABEL[inv.kind]} · {inv.number}
                      </p>
                      <p className="text-sm text-ink-500">
                        {formatMoney(inv.paidPence)} paid{paidOn ? ` on ${fmtDate(paidOn)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {payments.some((p) => p.invoiceId === inv.id && p.provider === "demo") && <Badge tone="warn">DEMO: no money moved</Badge>}
                      <Badge tone="success" dot>
                        Paid
                      </Badge>
                      {receipts[0] && (
                        <Link href={`/d/${receipts[0].id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-700 underline">
                          Receipt
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <footer className="mt-12 text-sm text-ink-500">
          <p>
            Questions about a payment?{" "}
            {realPhone(settings.company.phone) ? (
              <>
                Call {settings.company.tradingName} on{" "}
                <a className="font-semibold text-ink-900 underline" href={`tel:${settings.company.phone.replace(/\s+/g, "")}`}>
                  {settings.company.phone}
                </a>{" "}
                or email{" "}
              </>
            ) : (
              <>Email {settings.company.tradingName} at </>
            )}
            <a className="font-semibold text-ink-900 underline" href={`mailto:${settings.company.email}`}>
              {settings.company.email}
            </a>
            .
          </p>
          <p className="mt-2">We only mark an invoice paid once the money has actually reached us.</p>
        </footer>
        <FlashRegion />
      </main>
    </div>
  );
}

const formatMoney = money;

function InvoiceCard({
  inv,
  overdue,
  doc,
  bank,
  cardOn,
  testMode,
  simulate,
  projectId,
  reach,
}: {
  inv: Invoice & { owedPence: number; creditPence: number };
  overdue: boolean;
  doc?: { id: string };
  bank?: { accountName: string; sortCode: string; accountNumber: string };
  cardOn: boolean;
  testMode: boolean;
  simulate: boolean;
  projectId: string;
  /** "call us on …", or "email us at …" while only the placeholder number is set. */
  reach: string;
}) {
  const partPaid = inv.owedPence < inv.totalPence;
  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm font-semibold text-ink-700">
            {INVOICE_KIND_LABEL[inv.kind]} invoice · {inv.number}
          </p>
          {overdue ? <Badge tone="warn">Overdue</Badge> : inv.dueOn ? <Badge tone="neutral">Due {fmtDate(inv.dueOn)}</Badge> : null}
        </div>
        <p className="mt-2 font-display text-4xl text-ink-900">{formatMoney(inv.owedPence)}</p>
        <p className="mt-1 text-sm text-ink-500">
          {partPaid
            ? `Still to pay, of ${formatMoney(inv.totalPence)} in all${inv.creditPence > 0 ? ` (${formatMoney(inv.creditPence)} of your credit is taken off)` : ""},`
            : "To pay"}
          {inv.dueOn ? ` by ${fmtDate(inv.dueOn)}` : ""}.{" "}
          {doc && (
            <Link href={`/d/${doc.id}`} className="font-semibold text-accent-700 underline">
              See the invoice
            </Link>
          )}
        </p>
      </div>

      {bank ? (
        <section className="border-t border-line bg-surface/50 px-5 py-4" aria-label={`Pay ${inv.number} by bank transfer`}>
          <h2 className="font-semibold text-ink-900">Pay by bank transfer</h2>
          <p className="mt-0.5 text-sm text-ink-500">No fees, and the best way for larger amounts.</p>
          <dl className="mt-3 space-y-2">
            {[
              ["Account name", bank.accountName],
              ["Sort code", bank.sortCode],
              ["Account number", bank.accountNumber],
              ["Reference", inv.number],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                <div className="min-w-0">
                  <dt className="text-xs text-ink-500">{label}</dt>
                  <dd className="truncate font-semibold tabular-nums text-ink-900">{value}</dd>
                </div>
                <CopyButton value={value!} label={label!.toLowerCase()} />
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-ink-700">
            Please use the reference <span className="font-semibold">{inv.number}</span> so we can match it. We&apos;ll email a receipt once it reaches us.
          </p>
          <ActionForm flash action={sentTransferAction.bind(null, projectId, inv.id)} submitLabel="I've sent it" variant="secondary" refresh={false} className="mt-3" busyLabel="Letting us know…" />
        </section>
      ) : null}

      {cardOn && (
        <section className="border-t border-line px-5 py-4" aria-label={`Pay ${inv.number} by card`}>
          <form method="post" action={`/api/pay/${inv.id}`}>
            <button
              type="submit"
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent-700 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-800"
            >
              Pay {formatMoney(inv.owedPence)} by card
            </button>
          </form>
          <p className="mt-2 text-center text-xs text-ink-500">
            Secure card payment with Stripe. {testMode && <span className="font-bold text-amber-800">TEST MODE: no real money moves.</span>}
          </p>
        </section>
      )}

      {!cardOn && simulate && (
        <section className="border-t border-amber-200 bg-amber-50 px-5 py-4" aria-label="Demo payment">
          <ActionForm flash
            action={simulatePaymentAction.bind(null, projectId, inv.id)}
            submitLabel={`Simulate card payment (DEMO — no money moves)`}
            variant="secondary"
            block
            busyLabel="Recording the demo payment…"
          />
          <p className="mt-2 text-xs text-amber-900">Card payments aren&apos;t set up here. This records a clearly labelled DEMO payment so the rest of the journey can be tried.</p>
        </section>
      )}

      {!bank && !cardOn && !simulate && (
        <section className="border-t border-line px-5 py-4">
          <p className="text-ink-900">
            To pay, {reach} and we&apos;ll give you our bank details.
          </p>
        </section>
      )}
    </li>
  );
}

function SignIn({ projectId }: { projectId: string }) {
  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
          <Link href="/" aria-label="Dang, It's Hot home">
            <Logo />
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-10">
        <h1 className="font-display text-3xl text-ink-900">Sign in to see your invoices</h1>
        <p className="mt-3 text-ink-700">
          To keep your details private, we&apos;ll email you a sign-in link. Use the link in any of our emails, or ask for a fresh one.
        </p>
        <LinkButton href={`/portal?next=${encodeURIComponent(`/p/${projectId}/pay`)}`} size="lg" className="mt-6">
          Email me a sign-in link
        </LinkButton>
      </main>
    </div>
  );
}
