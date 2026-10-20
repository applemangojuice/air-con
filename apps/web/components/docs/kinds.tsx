import Link from "next/link";
import type { ReactNode } from "react";
import {
  DOCUMENT_KIND_LABEL,
  ISSUE_KIND_LABEL,
  PD_CHECKS,
  TAX_CODES,
  decayResultText,
  earlyStartWording,
  pressureDecayRows,
  vacuumDecayRows,
  variationHasOwnRight,
  type Annotation,
  type CertificateSnapshot,
  type CommissioningCertificateSnapshot,
  type ContractSnapshot,
  type HandoverPackSnapshot,
  type InvoiceSnapshot,
  type ProposalOption,
  type ProposalSnapshot,
  type ReceiptSnapshot,
  type SurveyReportSnapshot,
  type VariationSnapshot,
} from "@aircon/domain";
import { AnnotatedImage } from "@/components/annotate/annotated-image";
import { TermsText } from "@/components/proposal/terms-text";
import { cancellationForm, cancellationInstructions, type TraderDetails } from "@/lib/comms/legal-text";
import { fmtDate, money } from "@/lib/format";
import { fmtInstant, num, plain } from "./format";
import { Bullets, DocSection, Facts, Table } from "./shell";

/**
 * One renderer per DocumentKind, each drawing only from its frozen
 * snapshot (contract §D documents.ts), so a document reads the same in a
 * year as the day it was issued. Where the law wants something the snapshot
 * doesn't hold (our complaints process, the cancellation form), it comes from
 * the current settings and says so. Legal wording carries "Template: needs
 * solicitor review" until settings mark it reviewed. Costs and margins are
 * never read here, whatever a snapshot holds.
 */

export interface DocPhoto {
  url: string | null;
  /** image/… or application/pdf. */
  contentType?: string;
  annotations: Annotation[];
  width?: number;
  height?: number;
  caption?: string;
}

/** What a renderer may use beyond its snapshot: signed photos, the current settings' words, live facts. */
export interface DocContext {
  photos: Map<string, DocPhoto>;
  legal: { termsReviewed: boolean; cancellationReviewed: boolean; termsVersion: string };
  company: { complaintsProcess: string; adr?: string; workmanshipGuarantee?: string; legalName: string; tradingName: string; geographicAddress: string; registeredAddress?: string; phone?: string; email: string };
  payments: { depositPct: number; depositTiming: "on-acceptance" | "before-kit-order"; balanceDueDays: number; methods: string[] };
  cancellationDays: number;
  /** Where links to other documents go (null: plain text). */
  docHref: (id: string) => string | null;
  /** Facts that may have moved on since the document was issued, from the live project. */
  live?: {
    electricalCert?: string;
    /** The certificate documents behind "received" and "registered", once they exist. */
    electricalCertDocumentId?: string;
    warrantyRegistered?: boolean;
    warrantyDocumentId?: string;
    serviceDueOn?: string;
    projectHref?: string;
  };
  /** Customer-visible as-built photos (handover pack). */
  asBuilt?: DocPhoto[];
}

const trader = (c: DocContext["company"]): TraderDetails => ({
  legalName: c.legalName,
  tradingName: c.tradingName,
  ...(c.geographicAddress ? { geographicAddress: c.geographicAddress } : {}),
  ...(c.registeredAddress ? { registeredAddress: c.registeredAddress } : {}),
  phone: c.phone,
  email: c.email,
});

function Photo({ photo, alt }: { photo: DocPhoto | undefined; alt: string }) {
  if (!photo) return null;
  return (
    <AnnotatedImage
      src={photo.url}
      annotations={photo.annotations}
      alt={alt}
      {...(photo.width ? { width: photo.width } : {})}
      {...(photo.height ? { height: photo.height } : {})}
      legend
      labels
      {...(photo.caption ? { caption: photo.caption } : {})}
      className="overflow-hidden rounded-xl"
    />
  );
}

const taxLabel = (code: keyof typeof TAX_CODES | undefined) => (code ? TAX_CODES[code]?.label : undefined);

/* ------------------------------------------------------------------ */
/* Proposal                                                            */
/* ------------------------------------------------------------------ */

function OptionBlock({ option, ctx, index, count }: { option: ProposalOption; ctx: DocContext; index: number; count: number }) {
  const pricing = option.pricing;
  return (
    <DocSection title={count > 1 ? `Option ${index + 1}: ${option.label}` : option.label} breakBefore={index > 0}>
      {option.summary && <p className="text-[15px] text-ink-900">{option.summary}</p>}
      {option.highlights?.length > 0 && <Bullets items={option.highlights} />}
      {option.roomCards?.length > 0 && (
        <div className="space-y-5">
          {option.roomCards.map((room) => (
            <div key={room.roomId} className="doc-avoid space-y-2">
              <h3 className="font-semibold text-ink-900">
                {room.roomName}: {room.unitName}
              </h3>
              {room.why && <p>{room.why}</p>}
              {room.highlights?.length > 0 && <Bullets items={room.highlights} />}
              <div className="grid gap-3 sm:grid-cols-2">
                {room.mediaIds.map((id) => (
                  <Photo key={id} photo={ctx.photos.get(id)} alt={`${room.roomName}: where the unit goes`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {option.outdoorMediaIds?.length > 0 && (
        <div className="doc-avoid space-y-2">
          <h3 className="font-semibold text-ink-900">Outside</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {option.outdoorMediaIds.map((id) => (
              <Photo key={id} photo={ctx.photos.get(id)} alt="Where the outdoor unit goes" />
            ))}
          </div>
        </div>
      )}
      <div className="doc-avoid">
        <Table
          head={["Price", "Amount"]}
          align={["left", "right"]}
          rows={[
            ...(option.priceLines ?? []).map((l) => [
              <span key="l">
                {l.label}
                {l.detail && <span className="block text-xs text-ink-500">{l.detail}</span>}
              </span>,
              money(l.amountPence),
            ]),
            [<strong key="t">Total{pricing?.taxPence ? ` (including ${taxLabel(pricing.taxCode) ?? "VAT"})` : ""}</strong>, <strong key="v">{money(pricing?.totalPence ?? 0)}</strong>],
          ]}
        />
        {pricing && !pricing.taxPence && pricing.taxCode === "outside-scope" && <p className="mt-2 text-xs text-ink-500">{TAX_CODES["outside-scope"].note}</p>}
        {option.installDays > 0 && (
          <p className="mt-2">
            Installation takes {option.installDays} working day{option.installDays === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </DocSection>
  );
}

export function ProposalDoc({ snap, ctx }: { snap: ProposalSnapshot; ctx: DocContext }) {
  const p = snap.proposal;
  return (
    <>
      <DocSection title="Summary">
        <Facts
          rows={[
            ["Proposal version", String(p.version)],
            ["Valid until", p.validUntil ? fmtDate(p.validUntil) : ""],
            ["Options", String(p.options.length)],
            ["Your instant price", p.instantPriceGbp ? `${money(p.instantPriceGbp * 100)} (from your online quote)` : ""],
            ["Why the price changed", p.increaseReason ?? ""],
            ["Terms", p.termsVersion],
          ]}
        />
      </DocSection>
      {p.options.map((o, i) => (
        <OptionBlock key={o.id} option={o} ctx={ctx} index={i} count={p.options.length} />
      ))}
      <DocSection title="What's included">
        <Bullets items={p.inclusions ?? []} />
      </DocSection>
      <DocSection title="What isn't included">
        <Bullets items={p.exclusions ?? []} />
      </DocSection>
      {(p.assumptions ?? []).length > 0 && (
        <DocSection title="What we've assumed">
          <Bullets items={p.assumptions} />
        </DocSection>
      )}
      {p.planningNote && (
        <DocSection title="Planning and noise">
          <p>{p.planningNote}</p>
        </DocSection>
      )}
      <DocSection title="Guarantees and warranty">
        <p>{p.warranty ?? "No manufacturer warranty is stated in this proposal."}</p>
        {p.guarantees?.length ? (
          // The lines frozen on this proposal (the workmanship guarantee's length included), never today's settings.
          p.guarantees.filter((g) => !g.startsWith("Manufacturer's warranty:")).map((g, i) => <p key={i}>{g}</p>)
        ) : (
          ctx.company.workmanshipGuarantee && <p>{ctx.company.workmanshipGuarantee}</p>
        )}
      </DocSection>
      {p.acceptance && <AcceptanceBlock a={p.acceptance} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Contract confirmation                                               */
/* ------------------------------------------------------------------ */

function AcceptanceBlock({ a }: { a: NonNullable<ContractSnapshot["acceptance"]> }) {
  return (
    <DocSection title="Acceptance record">
      <Facts
        rows={[
          ["Accepted by", a.name],
          ["Email", a.email ?? ""],
          ["Accepted on", fmtInstant(a.at)],
          ["Option", a.optionLabel],
          ["Total agreed", money(a.totalPence)],
          ["Terms version", a.termsVersion],
          ["Cancellation notice version", a.cancellationNoticeVersion],
          ["Cancellation information acknowledged", a.acknowledgedCancellationInfo ? "Yes" : "No"],
          ["Asked us to start early", a.earlyStartRequested ? "Yes" : "No"],
        ]}
      />
    </DocSection>
  );
}

export function ContractDoc({ snap, ctx }: { snap: ContractSnapshot; ctx: DocContext }) {
  const o = snap.option;
  // Frozen at acceptance alongside the typed fields (proposal-server createContractDocument).
  const frozen = snap as ContractSnapshot & { cancellationInstructions?: { heading?: string; text: string }[]; cancellationForm?: string[] };
  const t = trader(ctx.company);
  const legal = { reviewed: ctx.legal.cancellationReviewed };
  const supply = snap.contractType !== "install-only";
  return (
    <>
      <DocSection title="Your contract with us">
        <p className="text-[15px] text-ink-900">
          This confirms the contract you made with {ctx.company.legalName} on {fmtInstant(snap.acceptance.at)}: {o.label}, for {money(snap.acceptance.totalPence)}
          {o.pricing?.taxPence ? ` including ${taxLabel(o.pricing.taxCode) ?? "VAT"}` : ""}. Keep it: it&apos;s your copy.
        </p>
        <Facts
          rows={[
            ["Contract type", supply ? "Supply and installation (we supply the equipment)" : "Installation only (you supply the equipment)"],
            ["Proposal", snap.proposalRef ? `${snap.proposalRef} (version ${snap.proposalVersion})` : `Version ${snap.proposalVersion}`],
            ["Terms", snap.termsVersion],
          ]}
        />
      </DocSection>
      <AcceptanceBlock a={snap.acceptance} />
      <DocSection title="What you're getting">
        {o.summary && <p>{o.summary}</p>}
        {(o.roomCards ?? []).length > 0 && <Bullets items={o.roomCards.map((r) => `${r.roomName}: ${r.unitName}`)} />}
        <Table
          head={["Price", "Amount"]}
          align={["left", "right"]}
          rows={[
            ...(o.priceLines ?? []).map((l) => [l.label, money(l.amountPence)]),
            [<strong key="t">Total</strong>, <strong key="v">{money(snap.acceptance.totalPence)}</strong>],
          ]}
        />
        {o.installDays > 0 && <p>Installation takes {o.installDays} working days, on dates you choose with us.</p>}
        {snap.performance && (
          <p>
            We&apos;ll finish your installation by {fmtDate(snap.performance.byDate)} (within {snap.performance.withinWeeks} weeks of the day you accepted), on dates agreed
            with you. If you choose later dates, it&apos;s by then instead.
          </p>
        )}
      </DocSection>
      <DocSection title="Included, not included, assumed">
        <p className="font-semibold text-ink-900">Included</p>
        <Bullets items={snap.inclusions} />
        <p className="font-semibold text-ink-900">Not included</p>
        <Bullets items={snap.exclusions} />
        {snap.assumptions.length > 0 && (
          <>
            <p className="font-semibold text-ink-900">Assumed</p>
            <Bullets items={snap.assumptions} />
          </>
        )}
        {snap.planningNote && (
          <>
            <p className="font-semibold text-ink-900">Planning and noise</p>
            <p>{snap.planningNote}</p>
          </>
        )}
      </DocSection>
      <DocSection title="Paying" legal={{ reviewed: ctx.legal.termsReviewed }}>
        {snap.payments ? (
          <>
            {/* The schedule frozen at acceptance (F4): a later settings change can't contradict the contract. */}
            <Bullets
              items={[
                ...(snap.payments.depositPct > 0
                  ? [
                      `A ${snap.payments.depositPct}% deposit${snap.payments.depositPence ? ` of ${money(snap.payments.depositPence)}` : ""}, ${snap.payments.depositTiming === "on-acceptance" ? "when you accept" : "before we order your equipment"}.`,
                      `The balance${snap.payments.depositPence ? ` of ${money(snap.acceptance.totalPence - snap.payments.depositPence)}` : ""} once the installation is finished, due within ${snap.payments.balanceDueDays} day${snap.payments.balanceDueDays === 1 ? "" : "s"} of our invoice.`,
                    ]
                  : [`No deposit. The full price once the installation is finished, due within ${snap.payments.balanceDueDays} day${snap.payments.balanceDueDays === 1 ? "" : "s"} of our invoice.`]),
                `You can pay by ${snap.payments.methods.map((m) => (m === "card" ? "card" : "bank transfer")).join(" or ") || "bank transfer"}.`,
              ]}
            />
            <p>You pay the total above, and nothing more unless you agree a change in writing first. Each invoice shows its amount and due date; your invoices and receipts are in your documents.</p>
          </>
        ) : (
          <p>
            You pay the total above, and nothing more unless you agree a change in writing first. Any deposit and the balance are each invoiced, with the amount and due date
            on the invoice, and you can pay by {ctx.payments.methods.map((m) => (m === "card" ? "card" : "bank transfer")).join(" or ")}. Your invoices and receipts are in your
            documents.
          </p>
        )}
      </DocSection>
      <DocSection title="Guarantees, complaints and disputes" legal={{ reviewed: ctx.legal.termsReviewed }}>
        {snap.guarantees?.length ? (
          // The guarantee lines as given at acceptance (F4), not whatever settings say today.
          <Bullets items={snap.guarantees} />
        ) : (
          <>
            <p>{snap.warranty ?? "No manufacturer warranty is stated in this contract."}</p>
            {ctx.company.workmanshipGuarantee && <p>{ctx.company.workmanshipGuarantee}</p>}
          </>
        )}
        {(snap.complaints?.process ?? ctx.company.complaintsProcess) ? (
          <p>{snap.complaints?.process ?? ctx.company.complaintsProcess}</p>
        ) : (
          <p className="text-amber-800">Our complaints process is to be added.</p>
        )}
        {(snap.complaints ? snap.complaints.adr : ctx.company.adr) && <p>{snap.complaints ? snap.complaints.adr : ctx.company.adr}</p>}
        <p className="text-xs text-ink-500">{snap.complaints ? "Complaints and dispute details as they stood when you accepted." : "Complaints and dispute details as currently published."}</p>
      </DocSection>
      <DocSection title="Your right to cancel" legal={legal}>
        <p className="text-[15px] font-semibold text-ink-900">{snap.cancellation.text}</p>
        {snap.cancellation.endsOn && <p>Your cancellation period ends at the end of {fmtDate(snap.cancellation.endsOn)}.</p>}
      </DocSection>
      {snap.acceptance.earlyStartRequested && (
        <DocSection title="Starting before the cancellation period ends" legal={legal}>
          <p>You asked us to start your installation before your cancellation period ends. To make that request on a durable medium, it needs to come from you in writing: reply to the email this document came with (or write to us) with these words:</p>
          <blockquote className="border-l-4 border-accent-500 pl-4 italic text-ink-900">{earlyStartWording(snap.contractType)}</blockquote>
          <p>
            If you then cancel after we&apos;ve started, you pay for the work done up to the time you tell us.
            {snap.acceptance.acknowledgedLossOfRight ? " You acknowledged that you lose the right to cancel once the work is fully completed." : ""}
          </p>
        </DocSection>
      )}
      <DocSection title="Cancellation instructions" legal={legal} breakBefore>
        {/* The wording as given at acceptance when the contract froze it; today's otherwise (older contracts). */}
        {(frozen.cancellationInstructions ?? cancellationInstructions(t, { contractType: snap.contractType, days: ctx.cancellationDays })).map((p, i) => (
          <div key={i}>
            {p.heading && <p className="mt-2 font-semibold text-ink-900">{p.heading}</p>}
            <p>{p.text}</p>
          </div>
        ))}
      </DocSection>
      <DocSection title="Model cancellation form" legal={legal}>
        <div className="space-y-3 rounded-xl border border-ink-900/40 p-4">
          {(frozen.cancellationForm ?? cancellationForm(t)).map((line, i) => (
            <p key={i} className={i > 3 && i < 8 ? "border-b border-dashed border-ink-300 pb-5" : ""}>
              {line}
            </p>
          ))}
        </div>
      </DocSection>
      {snap.termsText?.length ? (
        <DocSection title={`Our terms (version ${snap.termsVersion})`} legal={{ reviewed: ctx.legal.termsReviewed }} breakBefore>
          <p>The terms you accepted, word for word as they were when your proposal was issued.</p>
          <TermsText sections={snap.termsText} version={snap.termsVersion} open summary={`Our terms, version ${snap.termsVersion}`} />
          {snap.termsHash && (
            <p className="text-xs text-ink-500">
              Fingerprint (sha256): <span className="break-all font-mono">{snap.termsHash}</span>
            </p>
          )}
        </DocSection>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Variation                                                           */
/* ------------------------------------------------------------------ */

export function VariationDoc({ snap }: { snap: VariationSnapshot }) {
  const v = snap.issue.variation;
  const decided = v.status !== "proposed";
  return (
    <>
      <DocSection title={`Change #${snap.issue.number}: ${snap.issue.title}`}>
        {snap.issue.detail && <p>{snap.issue.detail}</p>}
        <p className="text-[15px] text-ink-900">{v.description}</p>
        <Table
          head={["", "Amount"]}
          align={["left", "right"]}
          rows={[
            // VAT rows only for a business that charges VAT (the variation's own tax code).
            ...((v.taxCode ?? (v.taxPence ? "standard-20" : "outside-scope")) === "outside-scope"
              ? []
              : ([
                  ["Price change before VAT", money(v.priceDeltaNetPence)],
                  ["VAT", money(v.taxPence)],
                ] as ReactNode[][])),
            [<strong key="t">Total price change</strong>, <strong key="v">{`${v.totalDeltaPence >= 0 ? "+" : ""}${money(v.totalDeltaPence)}`}</strong>],
          ]}
        />
      </DocSection>
      <DocSection title="Your decision">
        <Facts
          rows={[
            ["Status", decided ? (v.status === "accepted" ? "Accepted" : "Declined") : "Waiting for your answer"],
            ["Decided by", v.decidedBy ?? ""],
            ["Decided on", v.decidedAt ? fmtInstant(v.decidedAt) : ""],
            ["Contract", snap.contractRef ?? ""],
            ["Contract total", snap.contractTotalPence !== undefined ? money(snap.contractTotalPence) : ""],
            [
              v.status === "accepted" ? "New contract total" : "New total if accepted",
              snap.contractTotalPence !== undefined ? money(snap.contractTotalPence + v.totalDeltaPence) : "",
            ],
            ...(v.acceptance
              ? ([
                  ["What you agreed to", `“${v.acceptance.wording}”`],
                  ["Name typed", v.acceptance.name],
                  ...(v.acceptance.ip ? ([["From", v.acceptance.ip]] as [string, ReactNode][]) : []),
                  ["Fingerprint (sha256)", <span key="h" className="break-all font-mono text-xs">{v.acceptance.contentHash}</span>],
                ] as [string, ReactNode][])
              : []),
          ]}
        />
        <p>
          {v.status !== "accepted"
            ? "No extra work is done without your written yes. If you decline, we carry on exactly as agreed."
            : snap.cancellation || variationHasOwnRight(v)
              ? `This change is part of your contract and paid with your balance. You can cancel it${snap.cancellation ? ` until the end of ${fmtDate(snap.cancellation.endsOn)}` : " within 14 days of agreeing to it"} without giving a reason (the cancellation information and a form are in the email we sent you). We only start the extra work before then if you ask us to in writing; if you then cancel, you pay for the work done up to the time you tell us.`
              : "This change is part of your contract, on the same terms, and paid with your balance. Changed your mind? Tell us before we start this extra work and we won't do it."}
        </p>
      </DocSection>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Invoice + receipt                                                   */
/* ------------------------------------------------------------------ */

const INVOICE_KIND: Record<string, string> = {
  deposit: "Deposit",
  balance: "Balance",
  variation: "Variation",
  "survey-fee": "Survey fee",
  "change-fee": "Date change fee",
  "cancellation-charge": "Work done before cancelling",
  "credit-note": "Credit note",
};

export function InvoiceDoc({ snap }: { snap: InvoiceSnapshot }) {
  const inv = snap.invoice;
  const creditNote = inv.kind === "credit-note";
  const charge = inv.kind === "cancellation-charge";
  // What it asks for: after credit already on the account, as worked out at issue (the pay page's figure).
  const due = creditNote ? 0 : Math.max(0, snap.toPayPence ?? inv.totalPence - inv.paidPence);
  // VAT columns follow the tax code, never the amounts: a VAT-registered business's 0% (energy-saving
  // materials) invoice still shows its rate and VAT summary, and only "not registered" says so.
  const anyTax = inv.lines.some((l) => l.taxCode !== "outside-scope" || l.taxPence !== 0);
  const credit = snap.accountCredit && snap.accountCredit.pence > 0 ? snap.accountCredit : null;
  return (
    <>
      <DocSection
        title={
          creditNote
            ? `Credit note ${inv.number}`
            : charge
              ? `Invoice ${inv.number}: the work done before you cancelled`
              : `${INVOICE_KIND[inv.kind] ?? plain(inv.kind)} invoice ${inv.number}`
        }
      >
        <Facts
          rows={[
            [creditNote ? "Credit note number" : "Invoice number", inv.number],
            ["Issued", inv.issuedAt ? fmtDate(inv.issuedAt) : ""],
            ["Due", inv.dueOn && !creditNote ? fmtDate(inv.dueOn) : ""],
            ...(creditNote && inv.reason ? ([["Reason", inv.reason]] as [string, ReactNode][]) : []),
            ...(charge && inv.reason ? ([["How we worked it out", inv.reason]] as [string, ReactNode][]) : []),
          ]}
        />
        {charge && (
          <p className="text-sm text-ink-700">
            You cancelled inside your cancellation period after asking us to start early, so you pay for the work done up to the time you
            told us (Consumer Contracts Regulations 2013, regulation 36). Any equipment we supplied isn&apos;t part of this charge: it&apos;s
            dealt with separately under your cancellation rights. What you&apos;d paid us is credit against this invoice, and anything over it
            is refunded the same way you paid.
          </p>
        )}
        <Table
          head={anyTax ? ["Item", "Net", "VAT", "Total"] : ["Item", "Amount"]}
          align={anyTax ? ["left", "right", "right", "right"] : ["left", "right"]}
          rows={inv.lines.map((l) =>
            anyTax
              ? [
                  <span key="l">
                    {l.label}
                    <span className="block text-xs text-ink-500">{taxLabel(l.taxCode)}</span>
                  </span>,
                  money(l.netPence),
                  money(l.taxPence),
                  money(l.totalPence),
                ]
              : [l.label, money(l.totalPence)],
          )}
        />
        <Facts
          rows={[
            ...(anyTax ? ([["Net", money(inv.netPence)], ["VAT", money(inv.taxPence)]] as [string, ReactNode][]) : []),
            ["Total", <strong key="t">{money(inv.totalPence)}</strong>],
            ...(creditNote
              ? []
              : ([
                  ["Paid", money(inv.paidPence)],
                  ...(credit
                    ? ([
                        [
                          `Less: credit on your account${credit.creditNotes.length ? ` (credit note ${credit.creditNotes.join(", ")})` : ""}`,
                          `−${money(credit.pence)}`,
                        ],
                      ] as [string, ReactNode][])
                    : []),
                  ["To pay", <strong key="d">{money(due)}</strong>],
                ] as [string, ReactNode][])),
          ]}
        />
        {!anyTax && <p className="text-xs text-ink-500">{TAX_CODES["outside-scope"].note}</p>}
        {inv.notes && <p>{inv.notes}</p>}
      </DocSection>
      {snap.payTo && due > 0 && (
        <DocSection title="How to pay">
          {snap.payTo.methods.includes("bank-transfer") &&
            (snap.payTo.bank ? (
              <Facts
                rows={[
                  ["Account name", snap.payTo.bank.accountName],
                  ["Sort code", snap.payTo.bank.sortCode],
                  ["Account number", snap.payTo.bank.accountNumber],
                  ["Reference", <strong key="r">{snap.payTo.reference}</strong>],
                ]}
              />
            ) : (
              <p>Bank transfer: please call us for our bank details, and quote {snap.payTo.reference} as the reference.</p>
            ))}
          {snap.payTo.methods.includes("card") && <p>Or pay by card from your project page.</p>}
          <p className="text-xs text-ink-500">We&apos;ll never ask you to pay into a different account by email or text. If anything looks different, call us first.</p>
        </DocSection>
      )}
      {snap.payments.length > 0 && (
        <DocSection title="Payments received">
          <Table
            head={["Date", "Method", "Amount"]}
            align={["left", "left", "right"]}
            rows={snap.payments.map((p) => [fmtDate(p.receivedAt), plain(p.method), money(p.amountPence)])}
          />
        </DocSection>
      )}
    </>
  );
}

export function ReceiptDoc({ snap }: { snap: ReceiptSnapshot }) {
  const p = snap.payment;
  return (
    <DocSection title={`Payment received: ${money(p.amountPence)}`}>
      <p className="text-[15px] text-ink-900">Thank you. We&apos;ve received your payment.</p>
      <Facts
        rows={[
          ["Amount", money(p.amountPence)],
          ["Received", fmtInstant(p.receivedAt)],
          ["Method", p.method === "bank-transfer" ? "Bank transfer" : plain(p.method)],
          // The reference they used (a bank transfer's), never our own bookkeeping id.
          [p.method === "bank-transfer" ? "Your reference" : "Payment reference", p.reference ?? (p.provider === "manual" ? "" : p.providerRef)],
          ["For invoice", snap.invoice?.number ?? ""],
          ["Invoice total", snap.invoice ? money(snap.invoice.totalPence) : ""],
          [
            "Still to pay on that invoice",
            snap.invoice ? money(Math.max(0, snap.stillToPayPence ?? snap.invoice.totalPence - snap.invoice.paidPence)) : "",
          ],
        ]}
      />
      {p.provider === "demo" && <p className="font-semibold text-amber-800">DEMO record: no real money moved.</p>}
    </DocSection>
  );
}

/* ------------------------------------------------------------------ */
/* Commissioning certificate                                           */
/* ------------------------------------------------------------------ */

function splits(s: Record<string, number>): string {
  const e = Object.entries(s ?? {});
  return e.length ? e.map(([room, c]) => `${room}: ${num(c, 1)} °C`).join(" · ") : "–";
}

function CommissioningResults({ commissioning }: { commissioning: CommissioningCertificateSnapshot["commissioning"] }) {
  return (
    <>
      {commissioning.results.map((r) => (
        <div key={r.system} className="doc-avoid space-y-2">
          <h3 className="font-semibold text-ink-900">{r.system}</h3>
          {/* The strength/tightness and vacuum decay tests exactly as measured, with the working (a record signed before the tests were judged has only the readings). */}
          {r.pressureTest && (
            <>
              <p className="pt-1 font-semibold text-ink-900">Strength and tightness test (oxygen-free nitrogen): {decayResultText(r.pressureTest)}</p>
              <Facts rows={pressureDecayRows(r.pressureTest.figures)} />
            </>
          )}
          {r.vacuumTest && (
            <>
              <p className="pt-1 font-semibold text-ink-900">Evacuation and decay test: {decayResultText(r.vacuumTest)}</p>
              <Facts rows={vacuumDecayRows(r.vacuumTest.figures)} />
            </>
          )}
          <Facts
            rows={[
              ["Strength test", r.pressureTest || r.strengthTestBar === undefined ? "" : `${num(r.strengthTestBar)} bar`],
              ["Pressure hold", r.pressureTest || r.holdBar === undefined ? "" : `${num(r.holdBar)} bar`],
              ["Vacuum reached", r.vacuumTest || r.vacuumMicrons === undefined ? "" : `${num(r.vacuumMicrons, 0)} microns`],
              ["Vacuum decay", r.vacuumTest || r.decayMicrons === undefined ? "" : `${num(r.decayMicrons, 0)} microns`],
              ["Refrigerant added", r.additionalChargeG !== undefined ? `${num(r.additionalChargeG, 0)} g` : ""],
              ["Temperature drop, cooling", splits(r.coolingSplitC)],
              ["Temperature rise, heating", splits(r.heatingSplitC)],
              ["Noise", r.noiseDb !== undefined ? `${num(r.noiseDb, 0)} dB(A)` : ""],
            ]}
          />
          {r.serials.length > 0 && <Table head={["Item", "Serial number"]} rows={r.serials.map((s) => [s.item, s.serial])} />}
        </div>
      ))}
    </>
  );
}

export function CommissioningDoc({ snap }: { snap: CommissioningCertificateSnapshot }) {
  const c = snap.commissioning;
  return (
    <>
      <DocSection title="Commissioning sign-off">
        <p className="text-[15px] text-ink-900">
          Your system was tested, commissioned in heating and cooling, and signed off on {fmtInstant(c.at)} by {c.signedBy.name}.
        </p>
        <Facts
          rows={[
            ["Signed by", c.signedBy.name],
            ["F-gas certificate", c.signedBy.qualificationRef],
            ["Company F-gas certificate", snap.company.fgasCompanyCert ? `${snap.company.fgasCompanyCert.body} ${snap.company.fgasCompanyCert.number}` : ""],
          ]}
        />
        {c.notes && <p>{c.notes}</p>}
      </DocSection>
      <DocSection title="Results">
        <CommissioningResults commissioning={c} />
      </DocSection>
      <DocSection title="Equipment installed">
        <Table head={["Where", "Equipment", "Model", "Serial"]} rows={snap.equipment.map((e) => [e.room, e.label, e.model, e.serial])} />
      </DocSection>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Certificate                                                         */
/* ------------------------------------------------------------------ */

export function CertificateDoc({ snap, ctx }: { snap: CertificateSnapshot; ctx: DocContext }) {
  const c = snap.certificate;
  const files = c.mediaIds.map((id) => ctx.photos.get(id)).filter((f): f is DocPhoto => Boolean(f));
  return (
    <>
      <DocSection title={c.title}>
        <Facts
          rows={[
            [c.kind === "warranty-registration" ? "Registration reference" : "Certificate number", c.reference ?? ""],
            ["Issued by", c.issuer ?? ""],
            ["Received", fmtDate(c.receivedOn)],
            ["Note", c.note ?? ""],
          ]}
        />
        <p>
          {c.kind === "electrical-installation"
            ? "Keep it with your home's paperwork: you may be asked for it if you sell the house. The Building Regulations compliance certificate for the circuit comes to you directly from the electrician's registration scheme; the heat pump's own Building Regulations certificate comes separately, from the scheme or council that covers the installation."
            : "Keep it with your home's paperwork: you'll need it for any warranty claim."}
        </p>
      </DocSection>
      {files.length > 0 && (
        <DocSection title={files.length === 1 ? "The document" : "The documents"}>
          <ul className="space-y-3">
            {files.map((f, i) =>
              f.contentType === "application/pdf" || !f.url ? (
                <li key={i}>
                  {f.url ? (
                    <a href={f.url} className="font-semibold text-accent-700 underline" target="_blank" rel="noreferrer">
                      Open {f.caption ?? `the ${c.kind === "warranty-registration" ? "confirmation" : "certificate"}`} (PDF)
                    </a>
                  ) : (
                    <span className="text-ink-500">The file is still uploading. Refresh in a minute.</span>
                  )}
                </li>
              ) : (
                <li key={i}>
                  <Photo photo={f} alt={f.caption ?? c.title} />
                </li>
              ),
            )}
          </ul>
        </DocSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Handover pack                                                       */
/* ------------------------------------------------------------------ */

// "not-required" is no longer recorded (a new circuit always needs its certificate); an older pack that holds it says so honestly.
const ELECTRICAL_STATUS: Record<string, string> = { pending: "To come", received: "Received", "not-required": "Not recorded: ask us" };

export function HandoverPackDoc({ snap, ctx }: { snap: HandoverPackSnapshot; ctx: DocContext }) {
  const cert = snap.documents.find((d) => d.kind === "commissioning-certificate");
  const certHref = cert ? ctx.docHref(cert.id) : null;
  const liveElectrical = ctx.live?.electricalCert;
  const liveWarranty = ctx.live?.warrantyRegistered;
  return (
    <>
      <DocSection title="Your system">
        <p className="text-[15px] text-ink-900">
          Installed and completed on {fmtDate(snap.completedOn)}. Everything you need to run it, look after it and get help is in this pack. Save it, or print it and keep it with your
          house papers.
        </p>
        <Table head={["Where", "Equipment", "Model", "Serial"]} rows={snap.equipment.map((e) => [e.room, e.label, e.model, e.serial])} />
      </DocSection>

      <DocSection title="1. Commissioning certificate">
        <p>
          Tested and signed off on {fmtInstant(snap.commissioning.at)} by {snap.commissioning.signedBy.name} (F-gas certificate {snap.commissioning.signedBy.qualificationRef}), with the
          readings for every unit.
        </p>
        {cert && (certHref ? <Link href={certHref} className="font-semibold text-accent-700 underline">Open the commissioning certificate ({cert.ref})</Link> : <p>Ref {cert.ref}.</p>)}
        <CommissioningResults commissioning={snap.commissioning} />
      </DocSection>

      <DocSection title="2. F-gas record">
        <Table
          head={["System", "Refrigerant", "Factory charge", "Added on site", "Total", "CO₂ equivalent"]}
          align={["left", "left", "right", "right", "right", "right"]}
          rows={snap.fgas.map((f) => [f.system, `${f.refrigerant} (GWP ${f.gwp})`, `${num(f.factoryChargeKg, 3)} kg`, `${num(f.additionalChargeKg, 3)} kg`, `${num(f.totalKg, 3)} kg`, `${num(f.tco2e, 3)} t`])}
        />
        <p>The completed F-gas label is fixed to your outdoor unit.</p>
      </DocSection>

      <DocSection title="3. Certificates">
        <Facts
          rows={[
            ["Electrical installation certificate (BS 7671)", ELECTRICAL_STATUS[snap.electricalCert.status] ?? plain(snap.electricalCert.status)],
            // Never "not needed" from the electrical status: the circuit's certificate and the heat pump's are separate.
            ["Building Regulations certificate for the new circuit", `Sent to you by the electrician's registration scheme, due by ${fmtDate(snap.electricalCert.dueBy)}. Tell us if it hasn't arrived.`],
            [
              "Building Regulations certificate for the heat pump",
              `Sent to you by the scheme that covers the installation (or the council's completion certificate), due by ${fmtDate(snap.electricalCert.dueBy)}. Tell us if it hasn't arrived.`,
            ],
            ["Now", liveElectrical && liveElectrical !== snap.electricalCert.status ? `${ELECTRICAL_STATUS[liveElectrical] ?? plain(liveElectrical)} (updated since this pack was issued)` : ""],
          ]}
        />
        {ctx.live?.electricalCertDocumentId && ctx.docHref(ctx.live.electricalCertDocumentId) && (
          <Link href={ctx.docHref(ctx.live.electricalCertDocumentId)!} className="font-semibold text-accent-700 underline">
            Open your electrical installation certificate
          </Link>
        )}
        <p>The new circuit and the heat pump itself are notifiable building work. Each compliance certificate is due within 30 days of completion; we chase them and add them to your documents.</p>
      </DocSection>

      <DocSection title="4. Running and maintaining it">
        <Facts rows={[["Operating and maintenance information", snap.maintenanceInfo.provided ? "Provided (the care guide below and the manufacturer's manuals)" : `Due by ${fmtDate(snap.maintenanceInfo.dueBy)}`]]} />
        <Bullets items={snap.care} />
        <p>
          {snap.maintenanceInfo.provided
            ? "We handed over the manufacturer's user and maintenance manuals at your walkthrough. Ask us any time and we'll email you a copy."
            : "The manufacturer's user and maintenance manuals come with your walkthrough. Ask us any time and we'll email you a copy."}
        </p>
      </DocSection>

      <DocSection title="5. Warranty and guarantee">
        <p>{snap.warranty.text ?? "No manufacturer warranty is stated."}</p>
        <Facts
          rows={[
            ["Manufacturer registration", (liveWarranty ?? snap.warranty.registered) ? "Registered for you" : snap.warranty.dueOn ? `We register it for you by ${fmtDate(snap.warranty.dueOn)}` : "We register it for you"],
          ]}
        />
        {snap.guarantees ? (
          // As agreed in their contract (frozen on the accepted proposal), never today's settings.
          snap.guarantees.map((g, i) => <p key={i}>{g}</p>)
        ) : (
          ctx.company.workmanshipGuarantee && <p>{ctx.company.workmanshipGuarantee}</p>
        )}
      </DocSection>

      {ctx.asBuilt && ctx.asBuilt.length > 0 && (
        <DocSection title="6. As-built photos">
          <div className="grid gap-3 sm:grid-cols-2">
            {ctx.asBuilt.map((ph, i) => (
              <Photo key={i} photo={ph} alt={ph.caption ?? "As built"} />
            ))}
          </div>
        </DocSection>
      )}

      <DocSection title="Service, problems and contacts">
        <p>{ctx.live?.serviceDueOn ? `Your first service is due around ${fmtDate(ctx.live.serviceDueOn)}. We'll remind you.` : "We'll remind you when your first service is due, about a year after installation."}</p>
        <p>
          Something not right? Report it from your project page
          {ctx.live?.projectHref ? (
            <>
              {" "}
              (<Link href={`${ctx.live.projectHref}#aftercare`} className="font-semibold text-accent-700 underline">report a problem</Link>)
            </>
          ) : null}
          , or call us.
        </p>
        <Table head={["Who", "Name", "Phone", "Email"]} rows={snap.contacts.map((c) => [c.label, c.name ?? "", c.phone ?? "", c.email ?? ""])} />
      </DocSection>

      {snap.documents.length > 0 && (
        <DocSection title="Your other documents">
          <ul className="space-y-1">
            {snap.documents.map((d) => {
              const href = ctx.docHref(d.id);
              return (
                <li key={d.id}>
                  {href ? (
                    <Link href={href} className="underline">
                      {d.title}
                    </Link>
                  ) : (
                    d.title
                  )}{" "}
                  <span className="text-ink-500">
                    ({DOCUMENT_KIND_LABEL[d.kind]}, {d.ref})
                  </span>
                </li>
              );
            })}
          </ul>
        </DocSection>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Survey report                                                       */
/* ------------------------------------------------------------------ */

const ROUTE: Record<string, string> = {
  "through-wall": "Straight through the wall",
  "external-trunking": "Outside, in trunking",
  "internal-concealed": "Inside, concealed",
  "via-loft": "Through the loft",
  other: "Other",
};

export function SurveyReportDoc({ snap, ctx }: { snap: SurveyReportSnapshot; ctx: DocContext }) {
  const s = snap.survey;
  const m = s.data;
  const rooms = m.rooms.filter((r) => r.include);
  const answer = (v: "yes" | "no" | "unsure" | undefined) => (v === "yes" ? "Yes" : v === "no" ? "No" : v === "unsure" ? "Not sure yet" : "Not checked");
  return (
    <>
      <DocSection title="Your survey">
        <Facts
          rows={[
            ["Surveyed by", s.surveyor?.name ?? ""],
            ["Date", s.submittedAt ? fmtInstant(s.submittedAt) : s.startedAt ? fmtInstant(s.startedAt) : ""],
            ["Who makes the decision", m.site.decisionMaker ?? ""],
            ["Ownership", m.site.ownerConfirmed ? `${plain(m.site.tenure)} (confirmed)` : plain(m.site.tenure)],
            ["Access", m.site.accessNotes ?? ""],
            ["Parking", m.site.parkingNotes ?? ""],
          ]}
        />
      </DocSection>
      {snap.promises.length > 0 && (
        <DocSection title="What we told you">
          <Bullets items={snap.promises} />
          <p className="text-xs text-ink-500">Anything we said that matters to your decision is written down here, so nothing gets lost.</p>
        </DocSection>
      )}
      <DocSection title="What you'd like">
        <Facts
          rows={[
            ["Priorities", m.wishes.priorities.map(plain).join(", ")],
            ["Heating", plain(m.wishes.heatingUse)],
            ["Timing", m.wishes.timing ?? ""],
            ["Notes", m.wishes.notes ?? ""],
          ]}
        />
      </DocSection>
      <DocSection title="Your home">
        <Facts
          rows={[
            ["Type", `${plain(m.house.type)}, ${plain(m.house.era)}`],
            ["Walls", plain(m.house.wallConstruction)],
            ["Storeys", String(m.house.storeys)],
            ["Loft access", m.house.loftAccess ? "Yes" : "No"],
            ["Listed or conservation area", plain(m.house.listedOrConservation)],
            ["Asbestos", `${plain(m.house.asbestosRisk)}${m.house.asbestosNote ? `: ${m.house.asbestosNote}` : ""}`],
            ["Notes", m.house.notes ?? ""],
          ]}
        />
      </DocSection>
      <DocSection title="Room by room">
        {rooms.map((r) => (
          <div key={r.id} className="doc-avoid space-y-2 border-b border-line pb-4 last:border-0">
            <h3 className="font-semibold text-ink-900">
              {r.name} <span className="font-normal text-ink-500">({plain(r.floor)} floor)</span>
            </h3>
            <Facts
              rows={[
                ["Size", r.lengthM && r.widthM ? `${num(r.lengthM)} × ${num(r.widthM)} m${r.areaM2 ? ` (${num(r.areaM2, 1)} m²)` : ""}` : r.areaM2 ? `${num(r.areaM2, 1)} m²` : ""],
                ["Ceiling height", r.ceilingHeightM ? `${num(r.ceilingHeightM)} m` : ""],
                ["Windows and sun", `${plain(r.glazing)} glazing, faces ${r.orientation}`],
                ["Pipe route", [r.route ? ROUTE[r.route] ?? plain(r.route) : "", r.pipeRunM ? `${num(r.pipeRunM, 1)} m` : "", r.routeNote ?? ""].filter(Boolean).join(", ")],
                ["Condensation drain", `${r.condensate === "pump" ? "Small pump" : r.condensate === "gravity" ? "Drains by gravity" : "To be confirmed"}${r.condensateNote ? `: ${r.condensateNote}` : ""}`],
                ["Things in the way", r.obstacles ?? ""],
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {r.mediaIds.map((id) => (
                <Photo key={id} photo={ctx.photos.get(id)} alt={`${r.name}`} />
              ))}
            </div>
          </div>
        ))}
      </DocSection>
      <DocSection title="Outside">
        {m.outdoor.positions.map((pos) => (
          <div key={pos.id} className="doc-avoid space-y-2">
            <h3 className="font-semibold text-ink-900">
              {pos.label}
              {pos.chosen ? <span className="ml-2 text-sm font-semibold text-emerald-800">Chosen spot</span> : null}
            </h3>
            <Facts
              rows={[
                ["Mounting", plain(pos.base)],
                ["Nearest neighbouring window", pos.distanceToNeighbourWindowM !== undefined ? `${num(pos.distanceToNeighbourWindowM, 1)} m` : ""],
                ["Hard surfaces within 1 m", pos.reflectingSurfaces ? ({ one: "One (Q2)", two: "Two (Q4)", three: "Three (Q8)" } as const)[pos.reflectingSurfaces] : ""],
                ["Access", pos.accessEquipment === "none" ? "No special access needed" : plain(pos.accessEquipment)],
                ["Defrost water", pos.defrostDrainage ?? ""],
                ["Notes", pos.note ?? ""],
              ]}
            />
            {pos.mediaId && <Photo photo={ctx.photos.get(pos.mediaId)} alt={pos.label} />}
          </div>
        ))}
      </DocSection>
      <DocSection title="Electrics">
        <Facts
          rows={[
            ["Fuse board", plain(m.electrics.boardType)],
            ["Spare ways", m.electrics.spareWays !== undefined ? String(m.electrics.spareWays) : ""],
            ["Cable route", [m.electrics.cableRouteM ? `${num(m.electrics.cableRouteM, 1)} m` : "", m.electrics.cableRouteNote ?? ""].filter(Boolean).join(", ")],
            ["Old-board asbestos check", plain(m.electrics.asbestosFlashGuard)],
            ["Notes", m.electrics.notes ?? ""],
          ]}
        />
      </DocSection>
      <DocSection title="Planning checks (permitted development)">
        <Table head={["Check", "Answer"]} rows={PD_CHECKS.map((c) => [c.label, answer(m.permissions.pd[c.id])])} />
        <p className="text-xs text-ink-500">These are checks, not a planning decision. Where anything is unclear we say so in your proposal.</p>
      </DocSection>
      {(m.assumptions.length > 0 || m.unknowns.length > 0) && (
        <DocSection title="Assumptions and things still to confirm">
          {m.assumptions.length > 0 && <Bullets items={m.assumptions} />}
          {m.unknowns.length > 0 && <Bullets items={m.unknowns} />}
        </DocSection>
      )}
    </>
  );
}

export { ISSUE_KIND_LABEL };
