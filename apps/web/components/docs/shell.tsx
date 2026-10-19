import Link from "next/link";
import type { ReactNode } from "react";
import { DOCUMENT_KIND_LABEL, type DocumentCompany, type DocumentCustomer, type DocumentRecord } from "@aircon/domain";
import { Mark } from "@/components/site/logo";
import { fmtDate } from "@/lib/format";
import { PrintButton } from "./print-button";

/**
 * The printed page every document shares (contract §D documents.ts): our
 * identity (legal and trading name, where we're established, company and
 * VAT numbers only when we have them), the document's ref, version, date and
 * status, and the customer and property. A4 on paper; a calm sheet of paper
 * on screen. Drafts and superseded versions carry a watermark so a printout
 * can never pass for the current one.
 */

const PRINT_CSS = `
@page { size: A4; margin: 14mm 14mm 16mm; }
@media print {
  html, body { background: #ffffff !important; }
  .doc-sheet { box-shadow: none !important; border: 0 !important; border-radius: 0 !important; padding: 0 !important; max-width: none !important; }
  .doc-avoid { break-inside: avoid; }
  .doc-break { break-before: page; }
  a { color: inherit !important; text-decoration: none !important; }
}
`;

export function DocToolbar({ back }: { back: { href: string; label: string } | null }) {
  return (
    <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
      {back ? (
        <Link href={back.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-700 hover:text-ink-900">
          <span aria-hidden>←</span> {back.label}
        </Link>
      ) : (
        <span />
      )}
      <PrintButton />
    </div>
  );
}

function Watermark({ status }: { status: DocumentRecord["status"] }) {
  if (status === "final") return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden print-exact">
      <span className="-rotate-[24deg] select-none whitespace-nowrap font-display text-[64px] text-ink-900/[0.07] sm:text-[110px]">
        {status === "draft" ? "DRAFT" : "SUPERSEDED"}
      </span>
    </div>
  );
}

function CompanyBlock({ company }: { company: DocumentCompany }) {
  const trading = company.tradingName && company.tradingName !== company.legalName;
  return (
    <div className="min-w-0 text-sm leading-relaxed text-ink-700">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="print-exact">
          <Mark size={34} />
        </span>
        <span className="font-display text-xl leading-none text-ink-900">{company.tradingName || company.legalName}</span>
      </div>
      <p className="font-semibold text-ink-900">
        {company.legalName}
        {trading ? <span className="font-normal text-ink-700">, trading as {company.tradingName}</span> : null}
      </p>
      {company.geographicAddress ? (
        <p>{company.geographicAddress}</p>
      ) : (
        <p className="text-amber-800">Business address to be added</p>
      )}
      <p>
        {company.phone} · {company.email}
      </p>
      {(company.companyNumber || company.vatNumber) && (
        <p>
          {company.companyNumber ? `Company no. ${company.companyNumber}` : ""}
          {company.companyNumber && company.vatNumber ? " · " : ""}
          {company.vatNumber ? `VAT no. ${company.vatNumber}` : ""}
        </p>
      )}
      {company.fgasCompanyCert?.number && (
        <p>
          F-gas company certificate: {company.fgasCompanyCert.body} {company.fgasCompanyCert.number}
        </p>
      )}
    </div>
  );
}

export function DocSheet({
  doc,
  company,
  customer,
  issuedAt,
  children,
}: {
  doc: Pick<DocumentRecord, "kind" | "title" | "ref" | "version" | "status" | "createdAt">;
  company: DocumentCompany;
  customer: DocumentCustomer;
  issuedAt: string;
  children: ReactNode;
}) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <article className="doc-sheet relative mx-auto max-w-[210mm] rounded-2xl border border-line bg-white p-5 text-ink-900 shadow-sm sm:p-10">
        <Watermark status={doc.status} />
        <header className="relative flex flex-col gap-6 border-b border-line pb-6 sm:flex-row sm:items-start sm:justify-between">
          <CompanyBlock company={company} />
          <dl className="shrink-0 text-sm sm:text-right">
            <dt className="sr-only">Document</dt>
            <dd className="font-display text-2xl leading-tight text-ink-900">{doc.title}</dd>
            {/* The kind, unless the title already says it ("Commissioning certificate" twice). */}
            {DOCUMENT_KIND_LABEL[doc.kind].toLowerCase() !== doc.title.trim().toLowerCase() && <dd className="mt-1 text-ink-500">{DOCUMENT_KIND_LABEL[doc.kind]}</dd>}
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 sm:justify-end">
              <dt className="text-ink-500">Ref</dt>
              <dd className="font-semibold tabular-nums">{doc.ref}</dd>
              <dt className="text-ink-500">Version</dt>
              <dd className="font-semibold">{doc.version}</dd>
              <dt className="text-ink-500">Date</dt>
              <dd className="font-semibold">{fmtDate(issuedAt || doc.createdAt)}</dd>
              <dt className="text-ink-500">Status</dt>
              <dd className={`font-semibold ${doc.status === "final" ? "text-emerald-800" : "text-amber-800"}`}>
                {doc.status === "final" ? "Final" : doc.status === "draft" ? "Draft: not issued" : "Superseded by a newer version"}
              </dd>
            </div>
          </dl>
        </header>
        <section className="relative grid gap-4 border-b border-line py-5 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Customer</p>
            <p className="mt-1 font-semibold">{customer.name || "Customer"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Property</p>
            <p className="mt-1 font-semibold">
              {customer.addressLine}
              {customer.postcode ? `, ${customer.postcode}` : ""}
            </p>
          </div>
        </section>
        <div className="relative space-y-8 pt-6">{children}</div>
        <footer className="relative mt-10 border-t border-line pt-4 text-xs text-ink-500">
          {company.legalName}
          {company.companyNumber ? ` · Company no. ${company.companyNumber}` : ""} · {doc.ref} · version {doc.version}
        </footer>
      </article>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

export function DocSection({ title, children, legal, breakBefore }: { title: string; children: ReactNode; legal?: { reviewed: boolean }; breakBefore?: boolean }) {
  return (
    <section className={`doc-avoid ${breakBefore ? "doc-break" : ""}`}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-display text-xl text-ink-900">{title}</h2>
        {legal && !legal.reviewed && (
          <span className="print-exact rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
            Template: needs solicitor review
          </span>
        )}
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-ink-700">{children}</div>
    </section>
  );
}

/** Two-column facts. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-[minmax(0,14rem)_1fr]">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="pt-2 text-ink-500 sm:border-b sm:border-line sm:pb-2">{k}</dt>
          <dd className="border-b border-line pb-2 font-medium text-ink-900 sm:pt-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Bullets({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-ink-500">None.</p>;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

/** A plain table that scrolls inside itself on a phone (never the page) and prints whole. */
export function Table({ head, rows, align }: { head: string[]; rows: ReactNode[][]; align?: ("left" | "right")[] }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 print:overflow-visible">
      <table className="w-full min-w-[28rem] border-collapse text-sm print:min-w-0">
        <thead>
          <tr className="border-b-2 border-ink-900/80 text-left">
            {head.map((h, i) => (
              <th key={h} scope="col" className={`py-2 pr-3 font-semibold text-ink-900 ${align?.[i] === "right" ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-line align-top">
              {r.map((c, ci) => (
                <td key={ci} className={`py-2 pr-3 ${align?.[ci] === "right" ? "text-right tabular-nums" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
