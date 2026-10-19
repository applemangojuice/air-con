import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import {
  cancellationSummary,
  fgasClaim,
  installDaysPhrase,
  listOutcodes,
  numberWord,
  paymentCopy,
  surveyDurationCopy,
  surveyPriceCopy,
  vatCopy,
  warrantyCopy,
  GUARANTEE_FALLBACK,
  type PublicSettings,
} from "@/components/site/claims";
import { primaryBtn, textLink } from "@/components/site/styles";
import { fromPrice } from "@/lib/example-prices";
import { homeAnchor } from "@/components/site/examples";
import { gbp } from "@/lib/format";
import { getPublicSettings } from "@/lib/public-settings";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Heating and cooling with an air-to-air heat pump: planning, noise, running costs, install time, guarantees and your right to cancel, answered straight.",
};

/**
 * The questions people ask before putting a heat pump (the thing most people
 * call air conditioning) in their home, answered honestly. Anything that
 * depends on a business decision (warranty, VAT, payment, coverage, who does
 * the work) is read from settings, so the answers never get ahead of the
 * facts. Rendered with FAQPage structured data from the same text.
 */
function faqsFor(s: PublicSettings): { q: string; a: string }[] {
  const anchor = homeAnchor();
  const from = fromPrice();
  const warranty = warrantyCopy(s);
  const fgas = fgasClaim(s);
  const pay = paymentCopy(s);
  const survey = [surveyPriceCopy(s), surveyDurationCopy(s)].filter(Boolean).join(", ").toLowerCase();
  const outcodes = s.serviceArea;

  return [
    {
      q: "Is this air conditioning or a heat pump?",
      a: "Both. What most people call air conditioning is an air-to-air heat pump: the same unit cools a room in summer and heats it in winter, by moving heat rather than making it. Every system we fit is set up for both, and we show you heating mode at handover.",
    },
    {
      q: "Do I need planning permission?",
      a: "Often not for a house, but it depends, so we never assume. In England, heat pumps can usually go in under permitted development when the outdoor unit meets size and siting rules and a noise limit for your neighbours, and the system isn't used only for cooling. Flats, listed buildings, conservation areas and Article 4 areas need extra checks. We check your home at the survey and tell you in your proposal.",
    },
    {
      q: "How much does it cost?",
      a: `One room starts from about ${gbp(from)} installed, and ${numberWord(anchor.rooms)} rooms in a typical three-bed home from about ${gbp(anchor.price)}, depending on rooms and pipe routes. ${vatCopy(s).long} Your online price is for your home, and it's confirmed at your survey.`,
    },
    {
      q: "How accurate is the online price?",
      a: "It's calculated from your answers, and every quote shows how confident we are in it. Photos make it more accurate. It's confirmed at your home survey: if the survey finds something your answers didn't show (an extra room, a fuse board that needs work), your proposal says exactly what changed and why, before you agree to anything.",
    },
    {
      q: "What happens at the survey?",
      a: `A surveyor visits (${survey}) to measure each room, check where the indoor and outdoor units could go and how the pipes would run, and look at your fuse board. Then we design your system and send a proposal with the price in writing. There's no obligation.`,
    },
    {
      q: "What does it cost to run?",
      a: "That depends on your tariff, your home and how you use it, so we won't promise a number. As a rule of thumb, a heat pump gives out three or more units of heat for each unit of electricity it uses, which is why it heats far more cheaply than a plug-in electric heater. Manufacturers publish this as SCOP (heating) and SEER (cooling), and your proposal names the exact units so you can check their figures.",
    },
    {
      q: "Is it noisy?",
      a: "Indoor units are very quiet on their lowest setting: the models we're looking at are rated from about 19 dB(A), roughly a whisper, though it varies by model and size. The outdoor unit is louder, so its position matters. We check it against the noise limit for your neighbours at the survey.",
    },
    {
      q: "How long does installation take?",
      a: `${installDaysPhrase(s).charAt(0).toUpperCase()}${installDaysPhrase(s).slice(1)} for most homes, and your proposal gives the plan for yours. Expect the power to be off for up to 30 minutes while the new circuit is connected. Before we leave, the system is tested and commissioned in heating and cooling, and you get your paperwork.`,
    },
    {
      q: "Who does the work?",
      a: `Refrigerant work legally needs F-gas certified engineers, and the new electrical circuit needs a registered electrician. ${fgas ?? ""} Before your install you'll see who's coming and the qualifications they actually hold.`.replace(/\s+/g, " "),
    },
    {
      q: "What guarantees do I get?",
      a: `${warranty ? `${warranty.headline}. ${warranty.body}` : GUARANTEE_FALLBACK} All of this is on top of your statutory rights, not instead of them.`,
    },
    {
      q: "How do I pay?",
      a: `Getting a price costs nothing${surveyPriceCopy(s) === "Free" ? ", and so does the survey" : ""}. ${pay.deposit} ${pay.balance} ${pay.methods}${s.finance.offered ? "" : " We don't offer finance at the moment."}`,
    },
    {
      q: "Can I change my mind?",
      a: `Yes. ${cancellationSummary(s).replace(/^If you accept, you/, "Once you accept, you")} If you'd like us to start sooner, you can ask us to, in writing. Our terms explain it in full.`,
    },
    {
      q: "Do I need my landlord's or freeholder's permission?",
      a: "If you rent, yes: you'll need your landlord's written consent. If you own a leasehold flat, your lease usually needs the freeholder's consent for the outdoor unit. We flag this in your quote and can give you the technical details consent requests usually ask for.",
    },
    {
      q: "Which areas do you cover?",
      a: outcodes.length
        ? `We're starting with ${listOutcodes(outcodes)}. Put your postcode in and we'll tell you straight away. If we're not there yet, you can ask us to email you once when we are.`
        : "We're finalising our first areas. Put your postcode in and we'll tell you straight away.",
    },
  ];
}

export default async function FaqPage() {
  const settings = await getPublicSettings();
  const faqs = faqsFor(settings);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <SiteHeader />
      <main>
        <section className="warm-gradient">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
            <h1 className="text-4xl font-display sm:text-5xl">Fair questions</h1>
            <p className="mt-4 text-lg text-ink-700">
              Everything people ask before putting a heat pump in their home for heating and cooling, answered
              without the sales gloss.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-line bg-white p-5 open:shadow-sm">
                <summary className="cursor-pointer list-none font-semibold text-ink-900 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-3">
                    {f.q}
                    <span aria-hidden className="shrink-0 text-xl leading-none text-accent-700 transition group-open:rotate-45">
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-ink-700">{f.a}</p>
              </details>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-accent-100 bg-accent-50 p-6">
            <p className="font-semibold">Something we haven&apos;t answered?</p>
            <p className="mt-1 text-sm text-ink-700">
              Email{" "}
              <a href={`mailto:${settings.company.email}`} className={textLink}>
                {settings.company.email}
              </a>{" "}
              {settings.company.phone ? `or call ${settings.company.phone} ` : ""}and a person replies. Or get your
              price: it&apos;s free and answers most questions by itself.
            </p>
            <Link href="/quote" className={`mt-4 ${primaryBtn}`}>
              Get my price
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
