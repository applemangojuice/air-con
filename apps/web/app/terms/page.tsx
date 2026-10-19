import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import type { TermsSection } from "@aircon/domain";
import { textLink } from "@/components/site/styles";
import { cancellationForm, cancellationInstructions, type TraderDetails } from "@/lib/comms/legal-text";
import { termsSections } from "@/lib/legal/terms";
import { getPublicSettings } from "@/lib/public-settings";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Terms",
  description:
    "How prices, home surveys, proposals, installation, payment, guarantees and your right to cancel work, with the model cancellation instructions and form.",
};

const LAST_UPDATED = "19 Oct 2026";

/**
 * The pilot terms, in plain English, from lib/legal/terms.ts: the same text
 * frozen onto every proposal at issue, shown before acceptance, emailed and
 * copied into the contract. Built from settings, so every fact (who we are,
 * VAT, payment, install length, guarantees, complaints) is the one the
 * business has actually decided. The model cancellation instructions and
 * form come from lib/comms/legal-text.ts (the same text the contract emails
 * carry). Marked as a draft under solicitor review until
 * settings.legal.termsReviewed.
 */
export default async function TermsPage() {
  const s = await getPublicSettings();
  const c = s.company;
  const days = s.scheduling.cancellationDays;
  const sections = termsSections(s);
  const trader: TraderDetails = {
    legalName: c.legalName,
    tradingName: c.tradingName,
    ...(c.geographicAddress ? { geographicAddress: c.geographicAddress } : {}),
    ...(c.registeredAddress ? { registeredAddress: c.registeredAddress } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    email: c.email,
  };
  const supplyInstructions = cancellationInstructions(trader, { contractType: "supply-and-install", days });
  const installOnlyInstructions = cancellationInstructions(trader, { contractType: "install-only", days });
  const form = cancellationForm(trader);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        {!s.legal.termsReviewed && (
          <div role="note" className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <p className="font-semibold">Draft: under solicitor review</p>
            <p className="mt-1 text-sm">
              These are the terms we intend to use for our first installations. A solicitor is reviewing them and
              they may change before you&apos;re asked to agree to anything. Every proposal carries the full text of
              the terms that apply to it, fixed on the day it&apos;s issued, and only that text forms part of your
              contract.
            </p>
          </div>
        )}

        <h1 className="text-4xl font-display">Terms</h1>
        <p className="mt-3 text-sm text-ink-500">
          Version {s.legal.termsVersion} · last updated {LAST_UPDATED}
        </p>

        <div className="mt-6 rounded-2xl border border-line bg-white p-5">
          <h2 className="font-semibold">In short</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-700">
            <li>Your online price is a real price, confirmed at a home survey. It only changes for a reason we put in writing.</li>
            <li>Nothing is agreed until you accept a written proposal. Getting a price or a survey commits you to nothing.</li>
            <li>
              You can cancel without giving a reason: when we supply the equipment, until {days} days after the last
              of it is delivered to you.
            </li>
            <li>Nothing extra is added without your written approval.</li>
            <li>Your statutory rights apply on top of everything here.</li>
          </ul>
        </div>

        <nav aria-label="On this page" className="mt-6">
          <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {sections.map((section, i) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="text-ink-700 underline-offset-2 hover:text-ink-900 hover:underline">
                  {i + 1}. {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((section, i) => (
          <Section key={section.id} section={section} n={i + 1}>
            {section.id === "data" && (
              <p>
                <Link href="/privacy" className={textLink}>
                  Read our privacy notice
                </Link>
              </p>
            )}
            {section.id === "cancel" && (
              <>
                {!s.legal.cancellationReviewed && (
                  <p className="text-sm text-ink-500">
                    The wording below follows the model in Schedule 3 to the Consumer Contracts Regulations 2013 and is
                    being reviewed by our solicitor.
                  </p>
                )}

                <div className="rounded-2xl border border-line bg-white p-5">
                  <h3 className="font-semibold">Model cancellation instructions</h3>
                  <p className="mt-1 text-sm text-ink-500">For contracts where we supply the equipment.</p>
                  <div className="mt-3 space-y-2 text-sm">
                    {supplyInstructions.map((p, k) => (
                      <div key={k}>
                        {p.heading && <p className="mt-3 font-semibold text-ink-900">{p.heading}</p>}
                        <p>{p.text}</p>
                      </div>
                    ))}
                  </div>
                  <details className="mt-4 rounded-xl border border-line p-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-ink-900">If we only install equipment you supply</summary>
                    <div className="mt-2 space-y-2">
                      {installOnlyInstructions.map((p, k) => (
                        <div key={k}>
                          {p.heading && <p className="mt-3 font-semibold text-ink-900">{p.heading}</p>}
                          <p>{p.text}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>

                <div className="rounded-2xl border border-line bg-white p-5">
                  <h3 className="font-semibold">Model cancellation form</h3>
                  <div className="mt-3 space-y-2 text-sm">
                    {form.map((line, k) => (
                      <p key={k}>{line}</p>
                    ))}
                  </div>
                  <p className="mt-3 text-sm text-ink-500">
                    Your contract confirmation email includes this form with your details, and we can post you a paper copy.
                  </p>
                </div>
              </>
            )}
          </Section>
        ))}
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ section, n, children }: { section: TermsSection; n: number; children?: ReactNode }) {
  return (
    <section id={section.id} className="mt-10 scroll-mt-24" aria-labelledby={`${section.id}-title`}>
      <h2 id={`${section.id}-title`} className="text-xl font-display">
        {n}. {section.title}
      </h2>
      <div className="mt-3 space-y-3 leading-relaxed text-ink-700">
        {section.items.length === 1 ? (
          <p className="whitespace-pre-line">{section.items[0]}</p>
        ) : (
          <ul className="list-disc space-y-2 pl-5">
            {section.items.map((item) => (
              <li key={item} className="whitespace-pre-line">
                {item}
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>
    </section>
  );
}
