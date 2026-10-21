import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { installDurationCopy, numberWord, vatCopy, warrantyCopy } from "@/components/site/claims";
import { exampleHomes, homeAnchor, roomsSummary } from "@/components/site/examples";
import { primaryBtn, textLink } from "@/components/site/styles";
import { examplePrices } from "@/lib/example-prices";
import { gbp } from "@/lib/format";
import { getPublicSettings } from "@/lib/public-settings";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Air conditioning and heat pump costs (2026): installed prices",
  description:
    "What home air conditioning (an air-to-air heat pump that heats as well as cools) costs to install: guide prices per room and per home, what moves the price, and how to judge running costs.",
};

/**
 * The cost page. Every price here comes from the same engine that prices
 * real quotes, so it can't drift from what customers are shown. Claims about
 * VAT, warranty and install length come from settings; running costs are
 * explained, not promised.
 */
export default async function CostGuidePage() {
  const settings = await getPublicSettings();
  const p = examplePrices();
  const vat = vatCopy(settings);
  const warranty = warrantyCopy(settings);

  const anchor = homeAnchor();
  const notes = [
    "One wall-mounted unit in a typical first-floor bedroom",
    "A larger unit for a bigger, busier room",
    "Multi-split: two indoor units, one outdoor unit",
  ];
  const table = exampleHomes().map((h, i) => ({
    config: h.label,
    price: h.price,
    note: notes[i] ?? roomsSummary(h.rooms),
  }));

  const included = [
    "The indoor and outdoor units",
    "Pipework, condensate drainage and the electrical connection",
    "Installation, testing and commissioning in heating and cooling",
    "Waste removal, and a walkthrough of how to use it",
    warranty ? warranty.headline : "The warranty terms in writing, in your proposal",
  ];

  const faqs = [
    {
      q: "How much does air conditioning cost to install in the UK?",
      a: `With us, one room starts from about ${gbp(Math.min(p.oneBedroom, p.livingRoom))} installed, and ${numberWord(anchor.rooms)} rooms in a typical three-bed home from about ${gbp(anchor.price)}, depending on rooms and layout. ${vat.long} Your exact price takes about two minutes online, and your home survey confirms it.`,
    },
    {
      q: "What's included in the price?",
      a: `${included.join("; ")}. If your home needs something extra (a fuse board upgrade, say), your proposal says what and why before you agree to anything.`,
    },
    {
      q: "How much does it cost to run?",
      a: "It depends on your tariff, your home and how you use it. As a rule of thumb, a heat pump gives out three or more units of heat for each unit of electricity, so it heats far more cheaply than a plug-in heater. Check the SCOP (heating) and SEER (cooling) figures for the exact units in your proposal.",
    },
    {
      q: "Why do quotes elsewhere vary so much?",
      a: "Most installers price each job after a sales visit, so quotes carry a premium for the unknown. We've mapped the common install patterns for London house types, which is why we can show a price online first and confirm it at a survey.",
    },
    {
      q: "Is it worth it in the UK?",
      a: "London summers now regularly pass 30°C, and the same unit heats efficiently in winter, so it isn't just for a few hot weeks. Whether it's worth it for your home is your call: the price is free to see and there's no obligation.",
    },
  ];

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
            <h1 className="text-4xl font-display sm:text-5xl">What home air conditioning costs</h1>
            <p className="mt-4 text-lg text-ink-700">
              Installed guide prices from the same engine that prices every quote we give, not averages from a
              directory. And because what most people call air conditioning is a heat pump, every price here heats
              as well as cools.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-display">Installed prices by home</h2>
          {/* Cards on a phone, a table from sm up: no sideways scrolling. */}
          <ul className="mt-4 space-y-3 sm:hidden">
            {table.map((row) => (
              <li key={row.config} className="rounded-sm border border-line bg-white p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold">{row.config}</p>
                  <p className="whitespace-nowrap text-lg font-bold">{gbp(row.price)}</p>
                </div>
                <p className="mt-1 text-sm text-ink-700">{row.note}</p>
              </li>
            ))}
          </ul>
          <div className="mt-4 hidden overflow-hidden rounded-sm border border-line bg-white sm:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Guide prices, installed</caption>
              <thead>
                <tr className="border-b border-line bg-surface text-left text-xs font-semibold text-ink-700">
                  <th scope="col" className="px-4 py-3">Home</th>
                  <th scope="col" className="px-4 py-3">Guide price, installed</th>
                  <th scope="col" className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {table.map((row) => (
                  <tr key={row.config}>
                    <th scope="row" className="px-4 py-3 text-left font-semibold">{row.config}</th>
                    <td className="whitespace-nowrap px-4 py-3 text-lg font-bold">{gbp(row.price)}</td>
                    <td className="px-4 py-3 text-ink-700">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-ink-700">
            {vat.long} {installDurationCopy(settings)} for most homes. Your price depends on your rooms, and your
            home survey confirms it.
          </p>
          <Link href="/quote" className={`mt-5 ${primaryBtn}`}>
            Get my price
          </Link>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
            <h2 className="text-2xl font-display">What&apos;s included</h2>
            <ul className="mt-4 space-y-2">
              {included.map((item) => (
                <li key={item} className="flex gap-2.5 text-ink-700">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                  {item}
                </li>
              ))}
            </ul>
            <h2 className="mt-10 text-2xl font-display">Running costs, honestly</h2>
            <p className="mt-3 text-ink-700">
              We won&apos;t quote you a running cost, because it depends on your tariff, your home and how you use
              it. Here&apos;s how to judge it yourself: running cost is the electricity used times your unit rate.
              A heat pump moves heat rather than making it, so for heating it gives out three or more units of heat
              per unit of electricity. Manufacturers publish this as <strong>SCOP</strong> (heating) and{" "}
              <strong>SEER</strong> (cooling): the higher, the cheaper to run. Your proposal names the exact units,
              so you can check their figures.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-display">What moves the price</h2>
          <ul className="mt-4 space-y-3">
            {[
              ["Number of rooms", "Each indoor unit adds cost; the outdoor unit is shared, so the cost per room falls as you add rooms."],
              ["Pipe runs", "Longer routes between indoor and outdoor units mean more labour and materials. Terraces with rear access are usually simplest."],
              ["Room size and sun", "Bigger or sunnier rooms need more capacity: a larger unit, not a different install."],
              ["Electrics", "A modern fuse board with a spare way keeps things simple; older boards may need work first. We tell you before, never on the day."],
              ["Wall type and floor", "Loft rooms and solid-wall Victorian houses route differently to 1930s cavity-wall semis, and the survey is designed around exactly these differences."],
            ].map(([k, v]) => (
              <li key={k} className="flex gap-2.5">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                <span>
                  <strong>{k}.</strong> <span className="text-ink-700">{v}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-12 sm:px-6">
          <h2 className="text-2xl font-display">Cost questions, answered straight</h2>
          <div className="mt-4 space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-sm border border-line bg-white p-5">
                <summary className="cursor-pointer list-none font-semibold marker:content-none [&::-webkit-details-marker]:hidden">
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
          <p className="mt-6 text-sm text-ink-700">
            More questions? The{" "}
            <Link href="/faq" className={textLink}>
              full FAQ
            </Link>{" "}
            covers planning, noise, landlords and more, or email{" "}
            <a href={`mailto:${settings.company.email}`} className={textLink}>
              {settings.company.email}
            </a>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
