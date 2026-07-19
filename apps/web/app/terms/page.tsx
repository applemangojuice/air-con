import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms that govern quotes, bookings and installations.",
};

/**
 * Plain-English terms matching how the product actually works: instant fixed
 * quote → confidence score → deposit → install → 5-year warranty. Consumer
 * rights (14-day cooling off, Consumer Rights Act) stated, not buried.
 */
export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-4xl font-display">Terms of service</h1>
        <p className="mt-3 text-sm text-ink-300">Last updated: 19 July 2026</p>
        <p className="mt-5 text-ink-500">
          The deal in one paragraph: your quote is a genuine fixed price for
          the system it describes, based on the survey you gave us. If your
          home matches your survey, the price is the price. You get a 14-day
          cooling-off period, a 5-year warranty on the installation, and your
          statutory consumer rights on top of everything here.
        </p>

        <Section title="1. Who you're dealing with">
          <p>
            These terms are between you and {BRAND.legalName}
            (&ldquo;we&rdquo;, &ldquo;us&rdquo;). Contact:{" "}
            <a className="text-accent-700 hover:underline" href={`mailto:${BRAND.supportEmail}`}>
              {BRAND.supportEmail}
            </a>
            .
          </p>
        </Section>

        <Section title="2. Your quote">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              The quote is calculated from the survey you complete. It is a
              fixed, VAT-inclusive price for the system described in it.
            </li>
            <li>
              Every quote carries an Installation Confidence Score. A
              high-confidence quote (complete survey with photos) is guaranteed
              as-is. A lower-confidence quote may be revised after we review
              your details or visit, and you can always add the missing
              information to lock it in.
            </li>
            <li>
              If, on the day, your home materially differs from your survey
              (for example, a room or electrical setup isn&apos;t as
              described), we&apos;ll explain the difference and agree any
              change with you before doing any work. You can cancel at no cost
              if you don&apos;t accept the revised price.
            </li>
            <li>Quotes are valid for 60 days from the date they&apos;re generated.</li>
          </ul>
        </Section>

        <Section title="3. Booking and payment">
          <ul className="list-disc space-y-2 pl-5">
            <li>A booking is confirmed when you pay the deposit shown at booking.</li>
            <li>The balance is due on completion of the installation, once you&apos;re satisfied it works as described.</li>
            <li>
              Moving your installation date is free with reasonable notice;
              short-notice changes may carry the change fee shown when you
              rebook. We apply the same standard to ourselves: if we miss a
              commitment we&apos;ve put in writing, the stated credit comes off
              your bill automatically.
            </li>
          </ul>
        </Section>

        <Section title="4. Cooling off and cancellation">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              You have 14 days from booking to cancel for any reason with a
              full refund of your deposit (Consumer Contracts Regulations
              2013).
            </li>
            <li>
              If you ask us to install within the 14-day period, you&apos;re
              agreeing that the work may start before the cooling-off period
              ends; if you then cancel mid-way, we may charge for work already
              done.
            </li>
            <li>After 14 days, cancellation terms are shown at booking before you commit.</li>
          </ul>
        </Section>

        <Section title="5. The installation">
          <ul className="list-disc space-y-2 pl-5">
            <li>All work is carried out by F-Gas certified engineers.</li>
            <li>
              We&apos;re responsible for obtaining nothing on your behalf:
              where planning permission or freeholder/landlord consent is
              needed (we flag this in your quote when public records suggest
              it), obtaining it is your responsibility, and we&apos;ll help you
              understand what&apos;s required.
            </li>
            <li>
              We make good any damage we cause, document the installation
              (photos, pressure tests, commissioning data), and hand over the
              certificates.
            </li>
          </ul>
        </Section>

        <Section title="6. Warranty">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Every installation includes a 5-year parts and labour warranty,
              in addition to (not instead of) your rights under the Consumer
              Rights Act 2015.
            </li>
            <li>
              The warranty covers the system and our workmanship; it
              doesn&apos;t cover damage caused by tampering, or by servicing
              carried out by third parties without our agreement.
            </li>
          </ul>
        </Section>

        <Section title="7. Liability">
          <p>
            Nothing in these terms limits our liability for death or personal
            injury caused by negligence, for fraud, or for anything else that
            can&apos;t be limited by law. Otherwise, our liability under these
            terms is limited to the price you paid us. We&apos;re not liable
            for losses that aren&apos;t a foreseeable result of our breaking
            these terms.
          </p>
        </Section>

        <Section title="8. General">
          <p>
            These terms are governed by the law of England and Wales, and
            disputes go to the courts of England and Wales. If any part of
            these terms is found unenforceable, the rest still applies. Our{" "}
            <Link href="/privacy" className="text-accent-700 hover:underline">
              privacy policy
            </Link>{" "}
            explains how we handle your data.
          </p>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-display">{title}</h2>
      <div className="mt-3 space-y-3 text-ink-700 leading-relaxed">{children}</div>
    </section>
  );
}
