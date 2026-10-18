import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import {
  installDaysPhrase,
  paymentCopy,
  surveyDurationCopy,
  surveyPriceCopy,
  vatCopy,
  warrantyCopy,
} from "@/components/site/claims";
import { textLink } from "@/components/site/styles";
import { cancellationForm, cancellationInstructions, type TraderDetails } from "@/lib/comms/legal-text";
import { getPublicSettings } from "@/lib/public-settings";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Terms",
  description:
    "How prices, home surveys, proposals, installation, payment, guarantees and your right to cancel work, with the model cancellation instructions and form.",
};

const LAST_UPDATED = "18 Oct 2026";

const SECTIONS = [
  ["who", "Who we are"],
  ["price", "Your online price"],
  ["survey", "Your home survey"],
  ["contract", "Your proposal and your contract"],
  ["vat", "Prices and VAT"],
  ["changes", "Changes after you accept"],
  ["paying", "Paying"],
  ["install", "Your installation"],
  ["cancel", "Your right to cancel"],
  ["guarantees", "Guarantees and aftercare"],
  ["complaints", "If something goes wrong"],
  ["liability", "Our responsibility to you"],
  ["data", "Your information"],
  ["general", "The legal bits"],
] as const;

/**
 * The pilot terms, in plain English, built from settings so every fact
 * (who we are, VAT, payment, install length, guarantees, complaints) is the
 * one the business has actually decided. Includes the Schedule 2-style
 * information and the model cancellation instructions and form from
 * lib/comms/legal-text.ts (the same text the contract emails carry). Marked
 * as a draft under solicitor review until settings.legal.termsReviewed.
 */
export default async function TermsPage() {
  const s = await getPublicSettings();
  const c = s.company;
  const pay = paymentCopy(s);
  const vat = vatCopy(s);
  const warranty = warrantyCopy(s);
  const days = s.scheduling.cancellationDays;
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
  const surveyPrice = surveyPriceCopy(s);
  const surveyDuration = surveyDurationCopy(s);
  const survey = `${surveyPrice === "Free" ? "free" : `${surveyPrice}`}${surveyDuration ? ` and takes ${surveyDuration}` : ""}`;
  const tradingAs = c.tradingName && c.tradingName !== c.legalName ? ` (trading as ${c.tradingName})` : "";

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:px-6">
        {!s.legal.termsReviewed && (
          <div role="note" className="mb-8 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <p className="font-semibold">Draft: under solicitor review</p>
            <p className="mt-1 text-sm">
              These are the terms we intend to use for our first installations. A solicitor is reviewing them and
              they may change before you&apos;re asked to agree to anything. Your proposal includes the version that
              applies to you, and only that version forms part of your contract.
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
            {SECTIONS.map(([id, title], i) => (
              <li key={id}>
                <a href={`#${id}`} className="text-ink-700 underline-offset-2 hover:text-ink-900 hover:underline">
                  {i + 1}. {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Section id="who" n={1}>
          <p>
            These terms are between you and {c.legalName}
            {tradingAs} (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
          </p>
          <dl className="grid gap-x-4 gap-y-1 rounded-2xl border border-line bg-white p-4 text-sm sm:grid-cols-[auto_1fr]">
            {c.companyNumber && (
              <>
                <dt className="font-semibold">Company number</dt>
                <dd>{c.companyNumber} (registered in England and Wales)</dd>
              </>
            )}
            {c.registeredAddress && (
              <>
                <dt className="font-semibold">Registered office</dt>
                <dd>{c.registeredAddress}</dd>
              </>
            )}
            <dt className="font-semibold">Trading address</dt>
            <dd>{c.geographicAddress ?? "Set out in every proposal and contract confirmation."}</dd>
            <dt className="font-semibold">Email</dt>
            <dd>
              <a href={`mailto:${c.email}`} className={textLink}>
                {c.email}
              </a>
            </dd>
            {c.phone && (
              <>
                <dt className="font-semibold">Phone</dt>
                <dd>{c.phone}</dd>
              </>
            )}
            {c.vatNumber && (
              <>
                <dt className="font-semibold">VAT number</dt>
                <dd>{c.vatNumber}</dd>
              </>
            )}
          </dl>
        </Section>

        <Section id="price" n={2}>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Your online price is worked out from your answers by our pricing engine. It&apos;s a real price for the
              system it describes, and every quote shows how confident we are in it.
            </li>
            <li>
              We confirm it at your home survey. It can only change for something the survey finds that your answers
              didn&apos;t show: for example a different number or size of rooms, a longer pipe route, or electrical
              work your fuse board needs. Your proposal names each change and what it does to the price.
            </li>
            <li>
              An online price is valid for {s.quoteValidityDays} days from the day you get it. After that, your
              proposal confirms today&apos;s price.
            </li>
            <li>Getting, saving or sharing a price doesn&apos;t commit you to anything.</li>
            <li>
              We don&apos;t show &ldquo;was&rdquo; prices. If we offer a discount, your proposal shows it as its own
              line, with the reason.
            </li>
          </ul>
        </Section>

        <Section id="survey" n={3}>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              Your home survey is {survey}. A surveyor measures your rooms, checks where the indoor and
              outdoor units could go and how pipes and cables would run, checks your fuse board, and looks for
              anything that needs care, such as possible asbestos in older homes.
            </li>
            <li>There&apos;s no obligation, and we won&apos;t ask you to sign anything at the survey.</li>
            <li>Please make sure we can reach your fuse board and loft. If you need to rearrange, tell us as early as you can.</li>
          </ul>
        </Section>

        <Section id="contract" n={4}>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              After the survey we design your system, and a qualified engineer checks and signs off the design before
              we send you a price.
            </li>
            <li>
              Your proposal sets out the equipment for each room and where it goes, what&apos;s included and what
              isn&apos;t, the total price, how and when you pay, the install plan, the guarantees, your right to
              cancel, and how long the proposal is open.
            </li>
            <li>
              We&apos;ll ask whether you&apos;re happy to get your proposal, contract and cancellation information by
              email. If you&apos;d rather have them on paper, just say.
            </li>
            <li>
              You accept online by typing your name and confirming that you accept and agree to pay the total. That
              is when the contract is made. We then email you a confirmation of your contract with these terms and
              the cancellation form.
            </li>
            <li>Once you&apos;ve accepted, we can&apos;t change your proposal. Any change after that is a variation (section 6).</li>
          </ul>
        </Section>

        <Section id="vat" n={5}>
          <p>
            {vat.long} The total in your proposal includes everything you will necessarily pay. If any part
            can&apos;t be priced in advance, your proposal says how it would be worked out, before you accept.
          </p>
        </Section>

        <Section id="changes" n={6}>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              If you&apos;d like something changed, or we find something during the install that couldn&apos;t be
              seen at the survey, we&apos;ll explain it and give you the price difference in writing. We only go
              ahead once you&apos;ve approved it.
            </li>
            <li>Nothing extra is added on the day without your written agreement.</li>
            <li>
              If we find something unsafe to work on, such as suspected asbestos, we stop that part of the work and
              agree the next step with you.
            </li>
          </ul>
        </Section>

        <Section id="paying" n={7}>
          <ul className="list-disc space-y-2 pl-5">
            <li>{pay.deposit}</li>
            <li>{pay.balance}</li>
            <li>{pay.methods} We send an invoice for every payment, and we never ask for card details by phone or email.</li>
            {!s.finance.lenderConfigured && <li>We don&apos;t offer finance.</li>}
          </ul>
        </Section>

        <Section id="install" n={8}>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              You choose your install dates from the ones we offer. Most homes take {installDaysPhrase(s)}. We only
              start inside your cancellation period if you&apos;ve asked us to in writing (section 9).
            </li>
            <li>
              Your part: access to the rooms and outside, a clear space where we&apos;re working, parking information,
              and your landlord&apos;s or freeholder&apos;s written permission if you need it.
            </li>
            <li>
              We check planning at the survey and never assume it isn&apos;t needed. If planning permission is needed,
              we tell you before you accept; applying for it is your decision, and we&apos;ll help with the technical
              details.
            </li>
            <li>The power is off for up to 30 minutes while we connect the new circuit. We tell you before it happens.</li>
            <li>
              Before we leave, we test and commission the system in heating and cooling, show you how to use it, and
              give you your documents: equipment and serial numbers, commissioning results, the electrical
              certificate (or when it will follow), warranty details and a care guide.
            </li>
            <li>We put right any damage we cause.</li>
          </ul>
        </Section>

        <Section id="cancel" n={9}>
          <p>You can cancel without giving a reason.</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>When we supply the equipment</strong> (most jobs): until {days} days after the day the last
              item of your equipment is delivered to you.
            </li>
            <li>
              <strong>When you supply the equipment</strong> and we only install it: within {days} days of the day
              you accept.
            </li>
            <li>
              To cancel, tell us clearly: email{" "}
              <a href={`mailto:${c.email}`} className={textLink}>
                {c.email}
              </a>
              {c.phone ? `, call ${c.phone}` : ""} or write to us. You can use the form below, but you don&apos;t have
              to.
            </li>
            <li>
              <strong>Starting sooner.</strong> If you want us to start before your cancellation period ends, you need
              to ask us in writing, for example by replying to your contract confirmation email. If you then cancel
              after we&apos;ve started, you pay for the work done up to the time you tell us. When we supply the
              equipment you keep your right to cancel after installation; when you supply it, you lose the right to
              cancel once the work is fully done.
            </li>
            <li>
              If you cancel, we refund what you&apos;ve paid (less any amount for work done at your request) within 14
              days, by the same method you paid. When we supplied the equipment, we collect it and pay for doing so.
            </li>
          </ul>

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
              {supplyInstructions.map((p, i) => (
                <div key={i}>
                  {p.heading && <p className="mt-3 font-semibold text-ink-900">{p.heading}</p>}
                  <p>{p.text}</p>
                </div>
              ))}
            </div>
            <details className="mt-4 rounded-xl border border-line p-3 text-sm">
              <summary className="cursor-pointer font-semibold text-ink-900">
                If we only install equipment you supply
              </summary>
              <div className="mt-2 space-y-2">
                {installOnlyInstructions.map((p, i) => (
                  <div key={i}>
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
              {form.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-500">
              Your contract confirmation email includes this form with your details, and we can post you a paper copy.
            </p>
          </div>
        </Section>

        <Section id="guarantees" n={10}>
          <ul className="list-disc space-y-2 pl-5">
            {warranty ? (
              <li>
                <strong>{warranty.headline}.</strong> {warranty.body}
              </li>
            ) : (
              <li>
                Your proposal sets out the manufacturer&apos;s warranty for your equipment and any workmanship
                guarantee from us, in writing, before you agree to anything.
              </li>
            )}
            {c.workmanshipGuarantee && <li>{c.workmanshipGuarantee}</li>}
            <li>
              The law already requires the equipment we supply to match the contract and our work to be done with
              reasonable care and skill. Any guarantee is on top of these rights, not instead of them.
            </li>
            <li>Where a manufacturer&apos;s warranty needs registering, we register it and tell you when it&apos;s done.</li>
            <li>
              After your install we check in after a week, ask how it&apos;s going after a month, and remind you when a
              service is due. You can report a problem from your project page at any time.
            </li>
          </ul>
        </Section>

        <Section id="complaints" n={11}>
          {c.complaintsProcess ? (
            <p className="whitespace-pre-line">{c.complaintsProcess}</p>
          ) : (
            <p>
              Tell us what&apos;s gone wrong by email at{" "}
              <a href={`mailto:${c.email}`} className={textLink}>
                {c.email}
              </a>
              . Our full complaints process is set out in every proposal.
            </p>
          )}
          {c.adr && <p className="whitespace-pre-line">{c.adr}</p>}
        </Section>

        <Section id="liability" n={12}>
          <p>
            Nothing in these terms limits our liability for death or personal injury caused by negligence, for
            fraud, or for anything else that can&apos;t be limited by law. Otherwise, our liability under a contract
            is limited to the price you paid us. We&apos;re not liable for losses that aren&apos;t a foreseeable
            result of our breaking these terms.
          </p>
        </Section>

        <Section id="data" n={13}>
          <p>
            Our{" "}
            <Link href="/privacy" className={textLink}>
              privacy notice
            </Link>{" "}
            explains what we collect, why, how long we keep it and your rights.
          </p>
        </Section>

        <Section id="general" n={14}>
          <p>
            These terms are governed by the law of England and Wales, and disputes go to the courts of England and
            Wales. If any part of these terms is found unenforceable, the rest still applies.
          </p>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

function Section({ id, n, children }: { id: (typeof SECTIONS)[number][0]; n: number; children: ReactNode }) {
  const title = SECTIONS.find(([sid]) => sid === id)?.[1] ?? "";
  return (
    <section id={id} className="mt-10 scroll-mt-24" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-xl font-display">
        {n}. {title}
      </h2>
      <div className="mt-3 space-y-3 leading-relaxed text-ink-700">{children}</div>
    </section>
  );
}
