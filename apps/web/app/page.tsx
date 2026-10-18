import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { PostcodeForm } from "@/components/site/postcode-form";
import { ResumeBanner } from "@/components/site/resume-banner";
import { BrandArt } from "@/components/site/brand-art";
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
} from "@/components/site/claims";
import { onDarkBtn, primaryBtn, textLink } from "@/components/site/styles";
import { AREA_PAGES } from "@/app/areas/area-data";
import { appUrl } from "@/lib/brand";
import { fromPrice } from "@/lib/example-prices";
import { homeAnchor } from "@/components/site/examples";
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
          body: "Your proposal sets out the manufacturer's warranty and our workmanship guarantee in writing, before you agree to anything.",
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
      <main>
        {/* Hero */}
        <section className="warm-gradient">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_460px]">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-accent-100 bg-white px-3 py-1 text-xs font-semibold text-accent-700">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                Now booking home surveys in London
              </p>
              <h1 className="mt-5 text-4xl font-display text-ink-900 sm:text-6xl">
                Dang, it&apos;s hot. <span className="text-accent-700">Let&apos;s fix that.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-ink-700">
                Heat pumps that cool your home in summer and warm it in winter. Get your price in about two
                minutes, then we visit to confirm it. No salesperson, no clipboard, no more sleeping on top of the
                duvet with a wet flannel.
              </p>

              <PostcodeForm />
              <p className="mt-3 text-sm text-ink-500">
                Free and no obligation. No email needed to see your price.
              </p>
              <p className="mt-4 text-sm font-semibold text-ink-700">
                One room from {gbp(from)} installed · {numberWord(anchor.rooms)} rooms in a 3-bed home from{" "}
                {gbp(anchor.price)}
                {vat.short ? ` · ${vat.short}` : ""} ·{" "}
                <Link href="/guides/air-conditioning-cost-uk" className={`whitespace-nowrap ${textLink}`}>
                  cost guide
                </Link>
              </p>
            </div>
            <BrandArt priority />
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
          <h2 className="text-3xl font-display sm:text-4xl">From &ldquo;maybe&rdquo; to installed</h2>
          <p className="mt-3 max-w-2xl text-ink-700">
            Four steps, one at a time, and you can see what&apos;s next at every point.
          </p>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.n} className="rounded-2xl border border-line bg-surface p-6">
                <span className="text-sm font-bold text-accent-700">{s.n}</span>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-700">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <Link href="/quote" className={primaryBtn}>
              Get my price
            </Link>
          </div>
        </section>

        {/* Heating and cooling */}
        <section className="border-y border-line bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-display sm:text-4xl">It heats, too. Properly.</h2>
              <p className="mt-4 text-ink-700">
                What most people call air conditioning is an air-to-air heat pump. The unit that cools a bedroom in
                July heats it in January, moving heat rather than making it, so it uses far less electricity than a
                plug-in heater. Every system we fit is set up, tested and handed over for both.
              </p>
            </div>
            <ul className="space-y-4">
              {[
                ["Cool in summer", "Quiet indoor units for bedrooms, lofts and living rooms, the rooms that cook first."],
                ["Warm in winter", "Efficient heating room by room, alongside your radiators or instead of plug-in heaters."],
                [
                  "Planning, checked",
                  "Heat pumps on houses can often go in without planning permission when they meet the size, siting and noise rules and aren't used for cooling alone. We check yours at the survey; we never assume.",
                ],
              ].map(([title, body]) => (
                <li key={title} className="flex gap-3">
                  <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent-500" />
                  <span>
                    <span className="font-semibold">{title}.</span> <span className="text-ink-700">{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Promises */}
        <section className="bg-surface">
          <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
            <h2 className="text-3xl font-display sm:text-4xl">Not your usual tradespeople</h2>
            <p className="mt-2 max-w-2xl text-ink-700">Professional to a fault, and all of it in writing.</p>
          </div>
          <div className="mx-auto grid max-w-6xl gap-x-8 gap-y-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            {promises.map((p) => (
              <div key={p.title}>
                <h3 className="font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{p.body}</p>
              </div>
            ))}
          </div>
          {sla.length > 0 && (
            <div className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
              <div className="rounded-2xl border border-line bg-white p-6">
                <h3 className="font-semibold">Our service commitments</h3>
                <p className="mt-1 text-sm text-ink-700">If we miss one, the remedy comes off your bill. You don&apos;t have to ask.</p>
                <ul className="mt-4 divide-y divide-line text-sm">
                  {sla.map((c) => (
                    <li key={c.promise} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
                      <span className="text-ink-900">{c.promise}</span>
                      <span className="font-semibold text-ink-900">{c.remedy}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        {/* Honest about being new */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="rounded-3xl border border-accent-100 bg-accent-50 p-6 sm:p-10">
            <h2 className="text-2xl font-display sm:text-3xl">We&apos;re new, and we&apos;ll say so</h2>
            <p className="mt-3 max-w-3xl text-ink-700">
              We&apos;re surveying and installing our first homes now. So you won&apos;t find made-up reviews,
              borrowed badges or a &ldquo;thousands of happy customers&rdquo; banner here: just the work, done
              properly, photographed at every step and explained in plain English.
            </p>
            <Link href="/about" className={`mt-4 inline-block text-sm ${textLink}`}>
              Who we are
            </Link>
          </div>
        </section>

        {/* Areas + FAQ */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-display">Where we install</h2>
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
                              className="inline-block rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-accent-700 transition hover:border-accent-500"
                            >
                              {o} · {page.name}
                            </Link>
                          ) : (
                            <span className="inline-block rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700">
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
                Not on the list? Pop your postcode in anyway: if we&apos;re not there yet, you can ask us to email
                you once when we are.
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-display">The questions everyone asks</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="font-semibold">Does it heat as well as cool?</dt>
                  <dd className="text-ink-700">Yes. It&apos;s a heat pump: warm in winter, cool in summer.</dd>
                </div>
                <div>
                  <dt className="font-semibold">Do I need planning permission?</dt>
                  <dd className="text-ink-700">Often not for a house, but it depends. We check at your survey.</dd>
                </div>
                <div>
                  <dt className="font-semibold">How long does installing take?</dt>
                  <dd className="text-ink-700">{installDurationCopy(settings)} for most homes.</dd>
                </div>
              </dl>
              <Link href="/faq" className={`mt-4 inline-block text-sm ${textLink}`}>
                All the answers, straight
              </Link>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="ink-gradient">
          <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
            <h2 className="text-3xl font-display text-white sm:text-4xl">Ready to see your price?</h2>
            <p className="mx-auto mt-3 max-w-md text-white/80">
              About two minutes on your phone. No obligation, no pushy calls. Worst case, you go back to your fan
              knowing exactly what freedom costs.
            </p>
            <div className="mt-8">
              <Link href="/quote" className={onDarkBtn}>
                Get my price
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
