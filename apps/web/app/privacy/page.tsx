import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AnalyticsChoice } from "@/components/site/analytics-choice";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { textLink } from "@/components/site/styles";
import { getPublicSettings } from "@/lib/public-settings";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "How Dang, It's Hot collects, uses and protects your personal data, how long we keep it, and your rights.",
};

const LAST_UPDATED = "19 Oct 2026";

/**
 * Written to match what the platform actually does: the quote funnel and its
 * consents, customer and staff sign-in, project photos, SMS, card payments,
 * contractors, first-party analytics and the processors behind each. Laid out
 * the way the ICO expects: what, why, lawful basis, who else, how long, rights.
 */
export default async function PrivacyPage() {
  const s = await getPublicSettings();
  const email = s.company.email;
  const mail = (
    <a className={textLink} href={`mailto:${email}`}>
      {email}
    </a>
  );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        <h1 className="text-4xl font-display">Privacy notice</h1>
        <p className="mt-3 text-sm text-ink-500">Last updated {LAST_UPDATED}</p>
        <p className="mt-5 text-ink-700">
          Short version: we collect what we need to price, survey and install your heating and cooling, we don&apos;t
          run third-party trackers, we never sell your data, and we only send marketing if you ticked the box for it.
          You can ask what we hold, or ask us to correct or delete it, by emailing {mail}.
        </p>

        <Section title="Who we are">
          <p>
            {s.company.legalName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is the controller of the personal data
            described here.{s.company.registeredAddress ? ` Registered office: ${s.company.registeredAddress}.` : ""}{" "}
            Contact: {mail}.
          </p>
        </Section>

        <Section title="What we collect, and why">
          <ul className="list-disc space-y-3 pl-5">
            <Item name="Your quote">
              Your name, email, optional mobile number, address and the answers you give about your home, plus any
              photos you add. We use them to work out your price, save your quote and contact you about it.{" "}
              <Basis>taking steps at your request before a contract.</Basis>
            </Item>
            <Item name="Saved progress">
              If you give your email early in the quote, we save your answers so you can come back, and we may send
              one reminder if you don&apos;t finish. <Basis>legitimate interests: finishing the quote you started.</Basis>
            </Item>
            <Item name="Your consents">
              We record what you agreed to, when, and the exact words you saw: keeping you posted about your quote,
              and (only if you ticked it) news and offers. If you ask us to tell you when we reach your area, we
              keep your email and postcode for that one message.{" "}
              <Basis>consent for marketing; legal obligation to keep a record of it.</Basis>
            </Item>
            <Item name="Your project">
              If you go ahead: survey measurements and notes, photos of your rooms, outside walls, fuse board and the
              installation (some with drawings on them to show where things go), your design and proposal, your
              acceptance (the name you typed, the time, and the IP address and browser details sent with it), install records,
              commissioning results, certificates, invoices and payments, messages we&apos;ve sent you, and any
              issues you report. <Basis>performing our contract with you, and legal obligations (for example
              building regulations, F-gas and tax records).</Basis>
            </Item>
            <Item name="Texts">
              If you give a mobile number we text you about appointments, such as &ldquo;your surveyor is on the
              way&rdquo;. Operational texts never carry marketing. <Basis>performing our contract, or steps before
              it.</Basis>
            </Item>
            <Item name="Signing in">
              When you open a sign-in link from one of our emails, we set a cookie that keeps you signed in to your
              project page. Our staff and contractors sign in the same way, and we record who did what on each
              project. <Basis>legitimate interests: keeping your project secure.</Basis>
            </Item>
            <Item name="Usage analytics">
              Our own first-party analytics: pages viewed, approximate location (country and city, worked out by our
              hosting provider; we don&apos;t store your IP address), device type and how far you got through the
              quote. A random identifier is kept in your browser; it isn&apos;t linked to your name unless you save a
              quote. There are no third-party trackers and no advertising cookies. You can{" "}
              <a className={textLink} href="#analytics">
                turn analytics off
              </a>{" "}
              at any time. <Basis>legitimate interests: understanding and improving the service.</Basis>
            </Item>
            <Item name="Public property records">
              To design installations and decide where to offer our service, we use public data about properties
              (not people): Energy Performance Certificates, planning records and conservation-area maps. If we write
              to your address, the letter is addressed to the property, not a named person. You can ask us to stop.{" "}
              <Basis>legitimate interests.</Basis>
            </Item>
            <Item name="Video walkthroughs">
              Only if you use our capture app to send a narrated video of your home: the narration is transcribed and
              turned into a draft room list by AI service providers (OpenAI for transcription, Anthropic for the room
              list), who process it on our instructions. <Basis>taking steps at your request before a contract.</Basis>
            </Item>
          </ul>
        </Section>

        <Section title="Marketing, and how to stop it">
          <p>
            We only send news and offers by email if you ticked the box for them, and every one has an unsubscribe
            link. You can also email {mail} at any time. We keep a note that you opted out so we don&apos;t contact
            you again. Messages about your quote or project (appointments, your proposal, your contract, safety) are
            not marketing; while you have a live quote or project we&apos;ll still send those, and they never include
            sales content.
          </p>
        </Section>

        <Section title="Who else sees it">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Our team and contractors.</strong> Surveyors, installers and electricians, including
              subcontractors, see the details of the jobs they&apos;re assigned to (your name, address, contact
              details, access notes, photos and design), and nothing about other customers or our costs.
            </li>
            <li>
              <strong>Service providers</strong> who process data on our instructions: Supabase (database and photo
              storage), Vercel (hosting), Resend (email), Twilio (texts), Stripe (card payments: Stripe handles your
              card details and we never see the full number), getAddress.io (address lookup) and postcodes.io (your
              browser checks the postcode you type there).
            </li>
            <li>
              <strong>Where the law requires it</strong>: for example registering electrical work with a
              competent-person scheme or building control, F-gas records, manufacturer warranty registration (in
              your name), and HMRC.
            </li>
          </ul>
          <p>Some of these providers may process data outside the UK, under the safeguards UK law requires.</p>
        </Section>

        <Section title="How long we keep it">
          <ul className="list-disc space-y-2 pl-5">
            <li>Quotes you don&apos;t go ahead with: up to 24 months, then deleted.</li>
            <li>&ldquo;Tell me when you&apos;re in my area&rdquo; requests: until we&apos;ve sent that one email, or 24 months, whichever comes first.</li>
            <li>
              Installations: for the life of the warranty and as long as the law requires us to keep records (for
              example six years for tax records), then deleted.
            </li>
            <li>Consent and opt-out records: as long as we hold your details, so we can show what you agreed to.</li>
            <li>Analytics events: up to 24 months.</li>
          </ul>
        </Section>

        <Section title="Your rights">
          <p>
            You can ask for a copy of your data, ask us to correct or delete it, object to how we use it, ask us to
            restrict it, or withdraw consent at any time. Email {mail} and we&apos;ll reply within one month. If
            you&apos;re unhappy with how we handle your data, you can complain to the Information Commissioner&apos;s
            Office (
            <a className={textLink} href="https://ico.org.uk" rel="noopener noreferrer">
              ico.org.uk
            </a>
            ).
          </p>
        </Section>

        <Section title="Cookies and storage">
          <p>We use two small cookies, both strictly necessary for something you asked for:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Signing in</strong>: set when you open a sign-in link, it keeps you signed in to your project
              page (or, for our team, the staff tools).
            </li>
            <li>
              <strong>Your saved quote</strong> (<code>dih_quote</code>): set when you save a quote, it remembers for 7
              days which quotes were saved from this browser, so &ldquo;Book my home survey&rdquo; can open your project
              straight away. It holds only the quote references, signed so it can&apos;t be altered, and it never signs
              you in to anything else.
            </li>
          </ul>
          <p>
            The site also keeps a little data in your browser&apos;s storage: your in-progress quote (so you don&apos;t
            lose your answers) and, unless you turn analytics off, a random analytics identifier and how you first
            arrived (the referring site and any campaign tags in the link). Analytics off means we store nothing for
            analytics and send no usage events from this browser; your browser&apos;s Global Privacy Control signal
            counts as off. Clearing your browser data removes all of it.
          </p>
          <AnalyticsChoice />
        </Section>

        <Section title="Changes">
          <p>
            If this notice changes materially we&apos;ll update this page and the date at the top. Questions? {mail}.
          </p>
        </Section>

        <p className="mt-10 text-sm text-ink-700">
          See also our{" "}
          <Link href="/terms" className={textLink}>
            terms
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-display">{title}</h2>
      <div className="mt-3 space-y-3 leading-relaxed text-ink-700">{children}</div>
    </section>
  );
}

function Item({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li>
      <strong className="text-ink-900">{name}.</strong> {children}
    </li>
  );
}

function Basis({ children }: { children: ReactNode }) {
  return <em>Lawful basis: {children}</em>;
}
