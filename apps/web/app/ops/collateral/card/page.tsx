import Link from "next/link";
import type { Metadata } from "next";
import { BRAND, appHost } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Door-drop card · collateral · ops",
  robots: { index: false },
};

/**
 * The A5 door-drop card: side one is the hook, side two is the how. Print
 * to PDF gives two pages — the printer's front and back. Un-addressed, so
 * it works for whole-street drops where we haven't matched every UPRN yet.
 */
export default function DoorDropCardPage() {
  return (
    <>
      <div className="no-print border-b border-line bg-surface px-4 py-3 text-sm">
        <div className="mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3">
          <p className="text-ink-500">
            A5 door-drop card — print to PDF: page 1 is the front, page 2 the back.
          </p>
          <Link href="/ops/collateral" className="font-semibold text-accent-700 hover:underline">
            ← Collateral
          </Link>
        </div>
      </div>

      {/* Front */}
      <main className="print-exact mx-auto my-8 flex aspect-[210/148] max-w-xl flex-col justify-between bg-cream p-10 shadow-lg print:my-0 print:aspect-auto print:min-h-dvh print:max-w-none print:shadow-none print-page">
        <p className="text-xl font-bold">
          {BRAND.nameLead} <span className="text-accent-500">{BRAND.nameHot}</span>
        </p>
        <div>
          <p className="text-4xl font-display leading-tight">
            Your bedroom,
            <br />
            19°C.
            <br />
            <span className="text-accent-600">In July.</span>
          </p>
          <p className="mt-4 max-w-xs text-ink-500">
            Proper air conditioning for homes on this street — heating in winter too. Fixed price
            online in two minutes.
          </p>
        </div>
        <p className="text-lg font-bold">
          {appHost()} <span className="mx-2 font-normal text-ink-300">·</span>
          <span className="font-normal text-ink-500">your price, no salesperson</span>
        </p>
      </main>

      {/* Back */}
      <main className="print-exact mx-auto mb-8 flex aspect-[210/148] max-w-xl flex-col bg-white p-10 shadow-lg print:mb-0 print:aspect-auto print:min-h-dvh print:max-w-none print:shadow-none">
        <p className="text-lg font-display">Why your neighbours are doing it</p>
        <ul className="mt-4 space-y-2.5 text-sm text-ink-700">
          {[
            "A guaranteed fixed price online — not an estimate, no surveyor visit",
            "Cooling in summer, efficient heating in winter, one neat unit",
            "Installed in a day by F-Gas certified engineers, mess binned",
            "5-year parts & labour warranty in writing",
            "We install street by street, so your street's quirks are already designed for",
          ].map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
              {line}
            </li>
          ))}
        </ul>
        <div className="mt-auto rounded-2xl bg-surface p-4 text-center">
          <p className="font-display text-xl">
            {appHost()}<span className="text-accent-600">/quote</span>
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Two minutes, phone in hand. Or email {BRAND.supportEmail} and a human replies.
          </p>
        </div>
      </main>
    </>
  );
}
