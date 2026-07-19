import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${BRAND.name} collects, uses and protects your personal data.`,
};

/**
 * Written to match what the platform actually does (first-party cookieless
 * analytics, Supabase storage, Resend email, public-records property data),
 * in the brand voice but structured the way the ICO expects: what we
 * collect, why, the lawful basis, retention, and your rights.
 */
export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-4xl font-display">Privacy policy</h1>
        <p className="mt-3 text-sm text-ink-300">Last updated: 19 July 2026</p>
        <p className="mt-5 text-ink-500">
          Short version: we collect what we need to price and install your air
          conditioning, we don&apos;t run third-party trackers, we never sell
          your data, and you can ask us what we hold or ask us to delete it at
          any time by emailing{" "}
          <a className="font-semibold text-accent-700 hover:underline" href={`mailto:${BRAND.supportEmail}`}>
            {BRAND.supportEmail}
          </a>
          . The long version follows.
        </p>

        <Section title="Who we are">
          <p>
            {BRAND.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is the data
            controller for the personal data described here. Contact:{" "}
            <a className="text-accent-700 hover:underline" href={`mailto:${BRAND.supportEmail}`}>
              {BRAND.supportEmail}
            </a>
            .
          </p>
        </Section>

        <Section title="What we collect, and why">
          <ul className="list-disc space-y-3 pl-5">
            <li>
              <strong>Quote details.</strong> When you use the quote funnel we
              collect your name, email address, phone number (optional),
              address, and the survey you complete: rooms, property details and
              any photos you choose to add. We use this to calculate your
              price, save your quote, and contact you about it.{" "}
              <em>Lawful basis: taking steps at your request before entering a
              contract.</em>
            </li>
            <li>
              <strong>Saved progress.</strong> The funnel saves your enquiry
              from the first step (address and email) so you can come back and
              so we can follow up if you don&apos;t finish.{" "}
              <em>Lawful basis: legitimate interests — completing the quote you
              started.</em>
            </li>
            <li>
              <strong>Installation records.</strong> If you book, we keep the
              survey, design, price and installation documentation for your
              project, warranty and our legal obligations.{" "}
              <em>Lawful basis: performance of a contract.</em>
            </li>
            <li>
              <strong>Usage analytics.</strong> We run our own first-party
              analytics: pages viewed, approximate location (country and city,
              derived from your IP by our hosting provider — we never store the
              IP itself), device class, and how far you got through the quote.
              A random identifier is stored in your browser; it is not linked
              to your name unless you submit a quote.{" "}
              <em>Lawful basis: legitimate interests — understanding and
              improving the service.</em> There are no third-party trackers and
              no advertising cookies.
            </li>
            <li>
              <strong>Public property records.</strong> To design installations
              and decide where to offer our service, we process publicly
              available data about properties (not people): Energy Performance
              Certificates, planning applications and conservation-area maps.
              If we write to your address, that letter is addressed to the
              property, not to a named person.{" "}
              <em>Lawful basis: legitimate interests — offering a relevant
              service using public records.</em> You can ask us to stop
              contacting an address at any time.
            </li>
          </ul>
        </Section>

        <Section title="Where your data lives">
          <p>
            Data is stored with our infrastructure providers: Supabase
            (database and photo storage) and Vercel (hosting). Emails are sent
            through Resend. If you use address autofill, the postcode you type
            is sent to our address-lookup provider to return the address list.
            These providers process data on our instructions and don&apos;t use
            it for their own purposes.
          </p>
        </Section>

        <Section title="How long we keep it">
          <ul className="list-disc space-y-2 pl-5">
            <li>Quotes you don&apos;t proceed with: up to 24 months, then deleted.</li>
            <li>
              Installations: for the life of the warranty plus the period we
              are legally required to keep records.
            </li>
            <li>Analytics events: up to 24 months.</li>
          </ul>
        </Section>

        <Section title="Your rights">
          <p>
            You can ask us for a copy of your data, ask us to correct or delete
            it, object to our use of it, or ask us to restrict processing.
            Email{" "}
            <a className="text-accent-700 hover:underline" href={`mailto:${BRAND.supportEmail}`}>
              {BRAND.supportEmail}
            </a>{" "}
            and we&apos;ll respond within one month. If you&apos;re unhappy
            with how we handle your data, you can complain to the Information
            Commissioner&apos;s Office (
            <a className="text-accent-700 hover:underline" href="https://ico.org.uk" rel="noopener noreferrer">
              ico.org.uk
            </a>
            ).
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            We don&apos;t use cookies for tracking. The site stores a small
            amount of data in your browser&apos;s local storage: your
            in-progress quote (so you don&apos;t lose your answers) and a
            random analytics identifier. Clearing your browser data removes
            both.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If this policy changes materially we&apos;ll update this page and
            the date at the top. Questions?{" "}
            <a className="text-accent-700 hover:underline" href={`mailto:${BRAND.supportEmail}`}>
              {BRAND.supportEmail}
            </a>
            .
          </p>
        </Section>

        <p className="mt-10 text-sm text-ink-500">
          See also our{" "}
          <Link href="/terms" className="font-semibold text-accent-700 hover:underline">
            terms of service
          </Link>
          .
        </p>
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
