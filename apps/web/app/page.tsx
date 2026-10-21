import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { PostcodeForm } from "@/components/site/postcode-form";
import { ResumeBanner } from "@/components/site/resume-banner";
import {
  cancellationSummary,
  fgasClaim,
  installDurationCopy,
  numberWord,
  slaCommitments,
  surveyDurationCopy,
  surveyPriceCopy,
  vatCopy,
  warrantyCopy,
  GUARANTEE_FALLBACK,
} from "@/components/site/claims";
import { onDarkBtn, primaryBtn, textLink } from "@/components/site/styles";
import { AREA_PAGES } from "@/app/areas/area-data";
import { appUrl } from "@/lib/brand";
import { fromPrice } from "@/lib/example-prices";
import { exampleHomes, homeAnchor, roomsSummary } from "@/components/site/examples";
import { gbp } from "@/lib/format";
import { getPublicSettings } from "@/lib/public-settings";

export const revalidate = 60;

export const metadata: Metadata = {
  description:
    "Heat pumps that cool your home in summer and warm it in winter. Your price online in about two minutes, confirmed at a home survey. Now installing in our first London postcodes.",
};

export default async function HomePage() {
  const settings = await getPublicSettings();
  // Price anchors from the real engine, never hand-typed.
  const from = fromPrice();
  const anchor = homeAnchor();
  const vat = vatCopy(settings);
  const warranty = warrantyCopy(settings);
  const fgas = fgasClaim(settings);
  const sla = slaCommitments(settings);
  const surveyFacts = [surveyPriceCopy(settings), surveyDurationCopy(settings)].filter(Boolean).join(", ");
  const outcodes = settings.serviceArea.slice().sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  // Typical prices, from the same engine as a real quote (components/site/examples.ts).
  // A home whose rooms and price repeat an earlier row (a 4-bed terrace's middle bedroom can't take a unit) is left out.
  const examples = exampleHomes().filter(
    (h, i, all) => !all.slice(0, i).some((e) => e.price === h.price && e.rooms.join() === h.rooms.join()),
  );

  // The four facts under the hero: each one from settings, never a hard-coded promise.
  const facts = [
    { label: "Your price", value: "Online, in about two minutes" },
    { label: "Home survey", value: surveyFacts ? surveyFacts.charAt(0).toUpperCase() + surveyFacts.slice(1) : "Before anything is agreed" },
    { label: "Installation", value: installDurationCopy(settings) },
    { label: "Sign-off", value: fgas ? "F-gas certified company" : "Designed and signed off by a qualified engineer" },
  ];

  const steps = [
    {
      n: "01",
      title: "Get your price online",
      body: "A few taps about your home and your price appears, in about two minutes. If we already know your address, most of it's filled in. No email needed to see it.",
    },
    {
      n: "02",
      title: "A home survey",
      body: `${surveyFacts ? `${surveyFacts}. ` : ""}A surveyor measures each room, checks where the units and pipes can go, and looks at your fuse board. No sales pitch.`,
    },
    {
      n: "03",
      title: "Your proposal, in writing",
      body: "Designed on photos of your own rooms and signed off by a qualified engineer. If the price differs from your online price, it says exactly why. Then you decide.",
    },
    {
      n: "04",
      title: "Installed and handed over",
      body: `${installDurationCopy(settings)}, with an update at the end of each day. We commission it in heating and cooling, show you how it all works, and hand over your paperwork.`,
    },
  ];

  const promises = [
    {
      title: "Your price, in writing",
      body: "Your online price is confirmed at your survey. If anything changes, your proposal says what and why, before you agree to anything.",
    },
    {
      title: "No sales patter",
      body: "No salesperson, no \"today only\" prices, no one ringing to follow up. Take your time.",
    },
    {
      title: "People you can check",
      body: `Before your install you'll see who's coming and the qualifications they actually hold.${fgas ? ` ${fgas}` : ""}`,
    },
    warranty
      ? { title: warranty.headline, body: `${warranty.body} All on top of your statutory rights.` }
      : {
          title: "Guarantees, spelled out",
          body: GUARANTEE_FALLBACK,
        },
    {
      title: "Updates without chasing",
      body: "A short update with photos at the end of each install day, and one page that shows where everything's up to.",
    },
    { title: "Room to change your mind", body: cancellationSummary(settings).replace(/^If you accept, you/, "Once you accept, you") },
  ];

  /** LocalBusiness structured data: only facts we hold. */
  const businessJsonLd = {
    "@context": "https://schema.org",
    "@type": "HVACBusiness",
    name: settings.company.tradingName,
    legalName: settings.company.legalName,
    description: "Air-to-air heat pumps for heating and cooling homes, surveyed and installed in London.",
    email: settings.company.email,
    ...(settings.company.phone ? { telephone: settings.company.phone } : {}),
    url: appUrl(),
    areaServed: outcodes.map((o) => ({ "@type": "Place", name: `${o}, London` })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(businessJsonLd) }} />
      <SiteHeader />
      <ResumeBanner />
      <main className="bg-white">
        {/* Hero: what it is, the postcode box, and real prices beside it. */}
        <section className="border-b border-line">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_440px] lg:items-start">
            <div className="max-w-xl">
              <p className="text-sm font-semibold uppercase tracking-wider text-accent-700">Air conditioning · London</p>
              <h1 className="mt-4 font-display text-4xl leading-[1.08] text-ink-950 sm:text-[3.4rem]">
                Cool in summer, warm in winter. Priced in two minutes.
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-ink-700">
                We design and install air-to-air heat pumps in London homes. Enter your postcode: we look your home
                up in the public records, you check a few details, and your price appears. We confirm it at a home
                survey before you agree to anything.
              </p>

              <PostcodeForm />
              <p className="mt-3 text-sm text-ink-500">Free, no obligation, and no email needed to see your price.</p>
            </div>

            <div className="border border-line">
              <div className="flex items-baseline justify-between border-b border-line bg-cream px-5 py-3">
                <h2 className="text-sm font-semibold text-ink-900">Typical prices, installed</h2>
                <Link href="/guides/air-conditioning-cost-uk" className={`text-sm ${textLink}`}>
                  How we price
                </Link>
              </div>
              <ul className="divide-y divide-line">
                {examples.map((h) => (
                  <li key={h.label} className="flex items-start justify-between gap-4 px-5 py-3.5">
                    <span className="min-w-0">
                      <span className="block font-medium text-ink-900">{h.label}</span>
                      <span className="block text-xs text-ink-500">{roomsSummary(h.rooms)}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-ink-900">{gbp(h.price)}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-5 py-3 text-xs text-ink-500">
                From our price engine, the same one that prices your home{vat.short ? `. ${vat.short}` : ""}. Yours
                depends on your rooms, floors and where the outdoor unit goes.
              </p>
            </div>
          </div>
        </section>

        {/* Four facts */}
        <section className="border-b border-line bg-cream">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 px-4 sm:px-6 lg:grid-cols-4">
            {facts.map((f, i) => (
              <div key={f.label} className={`py-6 pr-4 ${i % 2 === 1 ? "pl-4 border-l border-line" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""} ${i === 2 ? "lg:border-l lg:pl-4" : ""}`}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-ink-500">{f.label}</dt>
                <dd className="mt-1.5 font-medium text-ink-900">{f.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl text-ink-950 sm:text-4xl">How it works</h2>
              <p className="mt-3 max-w-2xl text-ink-700">Four steps, and you always know which one you&apos;re on.</p>
            </div>
            <Link href="/quote" className={primaryBtn}>
              Get my price
            </Link>
          </div>
          <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.n} className="border-t-2 border-ink-900 pt-5">
                <span className="text-sm font-semibold tabular-nums text-accent-700">{s.n}</span>
                <h3 className="mt-2 text-lg font-semibold text-ink-950">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-700">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Heating and cooling */}
        <section className="border-y border-line bg-cream">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-3xl text-ink-950 sm:text-4xl">One system, all year</h2>
              <p className="mt-4 leading-relaxed text-ink-700">
                What most people call air conditioning is an air-to-air heat pump. The unit that cools a bedroom in
                July heats it in January, moving heat rather than making it, so it uses far less electricity than a
                plug-in heater. Every system we fit is set up, tested and handed over for both.
              </p>
            </div>
            <dl className="divide-y divide-line border-y border-line">
              {[
                ["Cooling", "Quiet indoor units for bedrooms, lofts and living rooms: the rooms that overheat first."],
                ["Heating", "Efficient heating room by room, alongside your radiators or instead of plug-in heaters."],
                [
                  "Planning",
                  "Heat pumps on houses can often go in without planning permission when they meet the size, siting and noise rules and aren't used for cooling alone. We check yours at the survey; we never assume.",
                ],
              ].map(([title, body]) => (
                <div key={title} className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr] sm:gap-6">
                  <dt className="font-semibold text-ink-950">{title}</dt>
                  <dd className="text-ink-700">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Promises */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="font-display text-3xl text-ink-950 sm:text-4xl">What you can expect from us</h2>
          <p className="mt-3 max-w-2xl text-ink-700">All of it in writing, before you agree to anything.</p>
          <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {promises.map((p) => (
              <div key={p.title} className="border-t border-line pt-5">
                <h3 className="font-semibold text-ink-950">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-700">{p.body}</p>
              </div>
            ))}
          </div>
          {sla.length > 0 && (
            <div className="mt-12 border border-line">
              <div className="border-b border-line bg-cream px-6 py-4">
                <h3 className="font-semibold text-ink-950">Our service commitments</h3>
                <p className="mt-1 text-sm text-ink-700">If we miss one, the remedy comes off your bill. You don&apos;t have to ask.</p>
              </div>
              <ul className="divide-y divide-line px-6 text-sm">
                {sla.map((c) => (
                  <li key={c.promise} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3">
                    <span className="text-ink-900">{c.promise}</span>
                    <span className="font-semibold text-ink-900">{c.remedy}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-12 border-l-2 border-accent-600 bg-cream px-6 py-5">
            <h3 className="font-semibold text-ink-950">We&apos;re new, and we say so</h3>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-700">
              We&apos;re surveying and installing our first homes now. You won&apos;t find made-up reviews or borrowed
              badges here: just the work, done properly, photographed at every step and explained in plain English.{" "}
              <Link href="/about" className={textLink}>
                Who we are
              </Link>
            </p>
          </div>
        </section>

        {/* Areas + FAQ */}
        <section className="border-t border-line bg-cream">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 md:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl text-ink-950">Where we install</h2>
              {outcodes.length > 0 ? (
                <>
                  <p className="mt-2 text-sm text-ink-700">We&apos;re starting in these postcodes:</p>
                  <ul className="mt-4 flex flex-wrap gap-2" aria-label="Postcode areas we cover">
                    {outcodes.map((o) => {
                      const page = AREA_PAGES[o.toLowerCase()];
                      return (
                        <li key={o}>
                          {page ? (
                            <Link
                              href={`/areas/${o.toLowerCase()}`}
                              className="inline-block rounded-sm border border-line bg-white px-3 py-1.5 text-sm font-semibold text-accent-700 transition hover:border-accent-600"
                            >
                              {o} · {page.name}
                            </Link>
                          ) : (
                            <span className="inline-block rounded-sm border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink-700">
                              {o}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : (
                <p className="mt-2 text-sm text-ink-700">We&apos;re finalising our first areas. Check back soon.</p>
              )}
              <p className="mt-4 text-sm text-ink-700">
                Not on the list? Put your postcode in anyway: if we&apos;re not there yet, you can ask us to email you
                once when we are.
              </p>
            </div>
            <div>
              <h2 className="font-display text-2xl text-ink-950">Common questions</h2>
              <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
                {[
                  ["Does it heat as well as cool?", "Yes. It's a heat pump: warm in winter, cool in summer."],
                  ["Do I need planning permission?", "Often not for a house, but it depends. We check at your survey."],
                  ["How long does installing take?", `${installDurationCopy(settings)} for most homes.`],
                  [
                    "What does it cost?",
                    `One room from ${gbp(from)} installed; ${numberWord(anchor.rooms)} rooms in a 3-bed home from ${gbp(anchor.price)}.`,
                  ],
                ].map(([q, a]) => (
                  <div key={q} className="py-3">
                    <dt className="font-semibold text-ink-950">{q}</dt>
                    <dd className="mt-0.5 text-ink-700">{a}</dd>
                  </div>
                ))}
              </dl>
              <Link href="/faq" className={`mt-4 inline-block text-sm ${textLink}`}>
                All questions and answers
              </Link>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-ink-950">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center">
            <div>
              <h2 className="font-display text-3xl text-white sm:text-4xl">See your price</h2>
              <p className="mt-2 max-w-md text-white/75">About two minutes on your phone. No obligation and no sales calls.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/quote" className={onDarkBtn}>
                Get my price
              </Link>
              <Link
                href="/faq"
                className="inline-flex min-h-12 items-center justify-center rounded-sm border border-white/30 px-6 py-3 font-semibold text-white transition hover:bg-white/10"
              >
                Read the FAQ
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
