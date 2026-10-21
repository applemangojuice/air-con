import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildDefaultConfig, generateQuote } from "@aircon/domain";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { installDurationCopy, vatCopy } from "@/components/site/claims";
import { roomsSummary } from "@/components/site/examples";
import { primaryBtn, textLink } from "@/components/site/styles";
import { gbp } from "@/lib/format";
import { getPublicSettings } from "@/lib/public-settings";
import { AREA_PAGES, type AreaPage } from "../area-data";

/**
 * Local landing pages. Honest and genuinely local: the housing stock we design
 * for, guide prices from the real engine (never hand-typed), and whether we
 * install there today, straight from the service area in settings.
 */

export const revalidate = 60;

export function generateStaticParams() {
  return Object.keys(AREA_PAGES).map((outcode) => ({ outcode }));
}

export async function generateMetadata({ params }: { params: Promise<{ outcode: string }> }): Promise<Metadata> {
  const { outcode } = await params;
  const area = AREA_PAGES[outcode.toLowerCase()];
  if (!area) return {};
  return {
    title: `Heating and cooling in ${area.name} (${area.outcode})`,
    description: `Heat pumps that cool in summer and heat in winter for homes in ${area.name}. Your price online in about two minutes, confirmed at a home survey.`,
  };
}

/** Guide price for a typical local home, from the real engine. */
function examplePrice(ex: AreaPage["examples"][number]): { price: number; rooms: string[] } {
  const config = buildDefaultConfig({ type: ex.type, era: ex.era, bedrooms: ex.bedrooms, bathrooms: 1, layout: "separate" });
  const price = generateQuote({
    postcode: "SW16 1AA",
    addressLine: "Example",
    archetypeId: config.archetypeId,
    permutationId: config.permutationId,
    property: { type: ex.type, era: ex.era, bedrooms: ex.bedrooms, ownership: "owner" },
    rooms: config.rooms,
    outdoor: { location: config.outdoorDefault, photos: [] },
    electrics: { condition: "unsure", photos: [] },
  }).totalGbp;
  return { price, rooms: config.rooms.map((r) => r.name) };
}

export default async function AreaPageView({ params }: { params: Promise<{ outcode: string }> }) {
  const { outcode } = await params;
  const area = AREA_PAGES[outcode.toLowerCase()];
  if (!area) notFound();

  const settings = await getPublicSettings();
  const covered = settings.serviceArea.includes(area.outcode);
  const vat = vatCopy(settings);
  const examples = area.examples.map((ex) => ({ ...ex, ...examplePrice(ex) }));

  const serviceJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Heat pump (heating and cooling) installation",
    provider: { "@type": "HVACBusiness", name: settings.company.tradingName, email: settings.company.email },
    areaServed: { "@type": "Place", name: `${area.name}, London ${area.outcode}` },
  };

  return (
    <>
      {covered && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />
      )}
      <SiteHeader />
      <main>
        <section className="warm-gradient">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
            <p className="text-sm font-semibold text-accent-700">
              {area.name} · {area.outcode}
            </p>
            <h1 className="mt-2 text-4xl font-display sm:text-5xl">Heating and cooling in {area.name}</h1>
            <p className="mt-4 text-lg text-ink-700">{area.intro}</p>
            {covered ? (
              <>
                <p className="mt-4 inline-flex rounded-sm border border-sage-200 bg-sage-50 px-3 py-1 text-sm font-semibold text-sage-900">
                  We install in {area.outcode}
                </p>
                <div className="mt-6">
                  <Link href="/quote" className={primaryBtn}>
                    Get my price
                  </Link>
                </div>
                <p className="mt-2 text-sm text-ink-500">About two minutes. If we already know your address, most of it is filled in.</p>
              </>
            ) : (
              <p className="mt-6 rounded-sm border border-line bg-white px-4 py-3 text-sm text-ink-700">
                We&apos;re not installing in {area.outcode} at the moment.{" "}
                <Link href="/areas" className={textLink}>
                  See where we install
                </Link>
                .
              </p>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-display">Homes like yours</h2>
          <ul className="mt-4 space-y-3">
            {area.housing.map((h) => (
              <li key={h} className="flex gap-2.5 text-ink-700">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                {h}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
            <h2 className="text-2xl font-display">What it typically costs here</h2>
            <p className="mt-2 text-ink-700">
              Guide prices from the same engine that prices your quote: the main rooms, heating and cooling,
              installed. {vat.long} Fewer rooms cost less.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {examples.map((ex) => (
                <div key={ex.label} className="rounded-sm border border-line bg-white p-5">
                  <p className="font-semibold">{ex.label}</p>
                  <p className="mt-2 text-3xl font-display">{gbp(ex.price)}</p>
                  <p className="mt-1 text-sm text-ink-700">{roomsSummary(ex.rooms)}</p>
                  <p className="mt-1 text-xs text-ink-500">A guide for a typical home. Yours is confirmed at your survey.</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-sm text-ink-700">{installDurationCopy(settings)} for most homes.</p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-display">Why street by street?</h2>
          <p className="mt-3 leading-relaxed text-ink-700">
            Because your neighbour&apos;s house is a lot like yours. Working one area at a time means what we learn
            three doors down makes your survey quicker and your design sharper. It also means our installers are
            local on the day, not fighting the South Circular.
          </p>
          {covered && (
            <div className="mt-8 rounded-sm border border-accent-100 bg-accent-50 p-6">
              <p className="font-semibold">Ready when you are</p>
              <p className="mt-1 text-sm text-ink-700">Start with your postcode and see your price in about two minutes.</p>
              <Link href="/quote" className={`mt-4 ${primaryBtn}`}>
                Get my price
              </Link>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
