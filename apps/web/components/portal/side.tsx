"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { DOCUMENT_KIND_LABEL } from "@aircon/domain";
import { fmtDay, fmtInstantDay, money } from "@/lib/format";
import { primaryCls, secondaryCls, useEchoesNextStep } from "./bits";
import { useHub } from "./controller";
import type { HubData } from "./types";

/**
 * The hub's supporting cards: updates, contact, documents and money. Each
 * stands alone, says plainly when it's empty, and never shows a number or
 * a document the customer can't act on or open.
 */

const card = "rounded-3xl border border-line bg-white p-5 sm:p-6";
const tel = (phone: string) => `tel:${phone.replace(/\s+/g, "")}`;

export function ContactCard({ data }: { data: HubData }) {
  return (
    <section aria-labelledby="contact-title" className={card}>
      <h2 id="contact-title" className="font-display text-xl text-ink-900">
        Questions? Talk to us
      </h2>
      <p className="mt-1 text-sm text-ink-500">Real people, the same team doing your install.</p>
      <div className="mt-4 grid gap-2">
        {data.company.phone && (
          <a href={tel(data.company.phone)} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 hover:border-ink-300">
            <span className="text-sm text-ink-500">Call</span>
            <span className="font-semibold text-ink-900">{data.company.phone}</span>
          </a>
        )}
        <a href={`mailto:${data.company.email}`} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 hover:border-ink-300">
          <span className="text-sm text-ink-500">Email</span>
          <span className="min-w-0 truncate font-semibold text-ink-900">{data.company.email}</span>
        </a>
      </div>
    </section>
  );
}

export function DocumentsCard({ data }: { data: HubData }) {
  const hub = useHub();
  const docs = data.documents.slice(0, 4);
  return (
    <section aria-labelledby="docs-title" className={card}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="docs-title" className="font-display text-xl text-ink-900">
          Your documents
        </h2>
        {hub.hrefs.documents && data.documents.length > 0 && (
          <Link href={hub.hrefs.documents} className="text-sm font-semibold text-accent-700 underline underline-offset-2">
            See all
          </Link>
        )}
      </div>
      {docs.length === 0 ? (
        <p className="mt-3 text-[15px] text-ink-700">Your proposal, contract, certificates and handover pack will all live here, ready to save or print.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {docs.map((d) => {
            const href = hub.hrefs.document(d.id);
            const body = (
              <>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink-900">{d.title}</span>
                  <span className="block text-xs text-ink-500">
                    {DOCUMENT_KIND_LABEL[d.kind]} · {fmtDay(d.createdAt)}
                  </span>
                </span>
                <span aria-hidden className="text-ink-500">
                  →
                </span>
              </>
            );
            return (
              <li key={d.id}>
                {href ? (
                  <Link href={href} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:text-accent-700">
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-14 items-center justify-between gap-3 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function PaymentsCard({ data, payButton }: { data: HubData; payButton?: ReactNode }) {
  const hub = useHub();
  const echoPay = useEchoesNextStep("Pay your deposit", "Pay your invoice", "Pay your balance");
  const m = data.money;
  const contract = data.project.proposal.contractTotalPence;
  if (m.invoicedPence === 0 && contract === undefined) return null;
  return (
    <section aria-labelledby="money-title" className={card}>
      <h2 id="money-title" className="font-display text-xl text-ink-900">
        Payments
      </h2>
      <dl className="mt-3 divide-y divide-line text-[15px]">
        {contract !== undefined && (
          <div className="flex justify-between gap-3 py-2">
            <dt className="text-ink-500">Contract total</dt>
            <dd className="font-semibold tabular-nums text-ink-900">{money(contract)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-ink-500">Invoiced so far</dt>
          <dd className="font-semibold tabular-nums text-ink-900">{money(m.invoicedPence)}</dd>
        </div>
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-ink-500">Paid</dt>
          <dd className="font-semibold tabular-nums text-emerald-800">{money(m.paidPence)}</dd>
        </div>
        <div className="flex justify-between gap-3 py-2">
          <dt className="text-ink-500">To pay now</dt>
          <dd className={`font-semibold tabular-nums ${m.outstandingPence > 0 ? "text-accent-700" : "text-ink-900"}`}>{money(m.outstandingPence)}</dd>
        </div>
      </dl>
      {data.invoices.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {data.invoices.map((i) => {
            const href = i.documentId ? hub.hrefs.document(i.documentId) : null;
            const label = `${i.number} · ${money(i.totalPence)}${i.status === "paid" ? " · paid" : i.dueOn ? ` · due ${fmtDay(i.dueOn)}` : ""}`;
            return (
              <li key={i.id} className="text-ink-700">
                {href ? (
                  <Link href={href} className="underline underline-offset-2 hover:text-accent-700">
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </li>
            );
          })}
        </ul>
      )}
      {m.outstandingPence > 0 && (
        <div className="mt-4">
          {hub.hrefs.pay ? (
            <Link href={hub.hrefs.pay} className={echoPay ? secondaryCls() : primaryCls()}>
              Pay {money(m.outstandingPence)}
            </Link>
          ) : (
            payButton
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-ink-500">Payments show here once they&apos;ve actually reached us, never before.</p>
    </section>
  );
}

export function UpdatesFeed({ data }: { data: HubData }) {
  const [all, setAll] = useState(false);
  const events = [...data.project.events].filter((e) => !e.internal && e.label).reverse();
  const shown = all ? events : events.slice(0, 5);
  return (
    <section aria-labelledby="updates-title" className={card}>
      <h2 id="updates-title" className="font-display text-xl text-ink-900">
        Updates
      </h2>
      {events.length === 0 ? (
        <p className="mt-3 text-[15px] text-ink-700">Everything that happens on your project shows up here.</p>
      ) : (
        <ol className="mt-4 space-y-4">
          {shown.map((e, i) => (
            <li key={`${e.at}-${i}`} className="flex gap-3">
              <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? "bg-accent-500" : "bg-line"}`} />
              <span className="min-w-0 text-[15px] leading-relaxed text-ink-900">
                {e.label}
                <span className="block text-xs text-ink-500">{fmtInstantDay(e.at)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {events.length > 5 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-4 min-h-11 text-sm font-semibold text-accent-700 underline underline-offset-2">
          {all ? "Show fewer" : `Show all ${events.length} updates`}
        </button>
      )}
    </section>
  );
}
