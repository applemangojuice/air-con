import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildDefaultConfig, generateQuote } from "@aircon/domain";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { BRAND } from "@/lib/brand";
import { gbp } from "@/lib/format";

/**
 * Local landing pages for the rollout areas. One honest, genuinely local
 * page per outcode — the housing stock we actually design for, indicative
 * prices computed by the real engine (never hand-typed), and the same
 * funnel CTA. This is how "air conditioning in Streatham" finds us.
 */

interface Area {
  outcode: string;
  name: string;
  intro: string;
  housing: string[];
  examples: { label: string; type: "semi-detached" | "terraced"; era: "pre-1930" | "1930-1950"; bedrooms: number }[];
}

const AREAS: Record<string, Area> = {
  sw16: {
    outcode: "SW16",
    name: "Streatham",
    intro:
      "Streatham is where we started. The housing stock is remarkably consistent — long Victorian terraces and inter-war semis — which is exactly why our fixed-price model works: we've already designed the install for a home like yours.",
    housing: [
      "Victorian terraces with rear additions: the outdoor unit usually sits at the rear at ground level, pipework runs beside the soil stack.",
      "1930s semis around Streatham Common and Norbury: side-passage runs make for tidy installs with short pipe routes.",
      "Loft conversions everywhere — and a converted loft is the hottest room in London. It's our most-requested room.",
    ],
    examples: [
      { label: "Victorian terrace, 3 bed", type: "terraced", era: "pre-1930", bedrooms: 3 },
      { label: "1930s semi, 3 bed", type: "semi-detached", era: "1930-1950", bedrooms: 3 },
    ],
  },
  sw17: {
    outcode: "SW17",
    name: "Tooting",
    intro:
      "Tooting's streets are our home turf: tight Victorian grids around the Broadway and Bec, inter-war stock towards Furzedown. Same terraces, same layouts, same install patterns — so the design work is done before you've finished your survey.",
    housing: [
      "Victorian mid-terraces off Tooting High Street: rear ground-level condenser, boxed riser at first floor — a pattern we fit week in, week out.",
      "End-of-terrace corners give more outdoor-unit options and often the simplest routes.",
      "Loft rooms and rear extensions are common — both are the rooms people most want cooled.",
    ],
    examples: [
      { label: "Victorian terrace, 3 bed", type: "terraced", era: "pre-1930", bedrooms: 3 },
      { label: "Larger terrace, 4 bed", type: "terraced", era: "pre-1930", bedrooms: 4 },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(AREAS).map((outcode) => ({ outcode }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ outcode: string }>;
}): Promise<Metadata> {
  const { outcode } = await params;
  const area = AREAS[outcode.toLowerCase()];
  if (!area) return {};
  return {
    title: `Air conditioning in ${area.name} (${area.outcode})`,
    description: `Fixed-price home air conditioning in ${area.name}. Two-minute survey, instant guaranteed price, installation by F-Gas certified engineers.`,
  };
}

/** Indicative price for a typical local home, from the real engine. */
function examplePrice(ex: Area["examples"][number]): number {
  const config = buildDefaultConfig({
    type: ex.type,
    era: ex.era,
    bedrooms: ex.bedrooms,
    bathrooms: 1,
    layout: "separate",
  });
  const quote = generateQuote({
    postcode: "SW16 1AA",
    addressLine: "Example",
    archetypeId: config.archetypeId,
    permutationId: config.permutationId,
    property: { type: ex.type, era: ex.era, bedrooms: ex.bedrooms, ownership: "owner" },
    rooms: config.rooms,
    outdoor: { location: config.outdoorDefault, photos: [] },
    electrics: { condition: "unsure", photos: [] },
  });
  return quote.totalGbp;
}

export default async function AreaPage({ params }: { params: Promise<{ outcode: string }> }) {
  const { outcode } = await params;
  const area = AREAS[outcode.toLowerCase()];
  if (!area) notFound();

  const examples = area.examples.map((ex) => ({ ...ex, price: examplePrice(ex) }));

  const serviceJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Home air conditioning installation",
    provider: { "@type": "HVACBusiness", name: BRAND.name, email: BRAND.supportEmail },
    areaServed: { "@type": "Place", name: `${area.name}, London ${area.outcode}` },
    description: `Fixed-price residential air conditioning in ${area.name} (${area.outcode}): self-survey, instant guaranteed quote, certified installation, 5-year warranty.`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }}
      />
      <SiteHeader />
      <main>
        <section className="warm-gradient">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
            <p className="text-sm font-semibold text-accent-700">
              {area.name} · {area.outcode}
            </p>
            <h1 className="mt-2 text-4xl font-display sm:text-5xl">
              Air conditioning in {area.name}
            </h1>
            <p className="mt-4 text-lg text-ink-500">{area.intro}</p>
            <Link
              href="/quote"
              className="mt-6 inline-block rounded-full bg-accent-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-700"
            >
              Get my fixed price
            </Link>
            <p className="mt-2 text-sm text-ink-300">
              Two minutes. If we already know your address, most of it is pre-filled.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-display">Homes like yours, designs already done</h2>
          <ul className="mt-4 space-y-3">
            {area.housing.map((h) => (
              <li key={h} className="flex gap-2.5 text-ink-700">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                {h}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
            <h2 className="text-2xl font-display">What it typically costs here</h2>
            <p className="mt-2 text-ink-500">
              Computed by the same engine that prices your actual quote — whole-house comfort,
              installed, VAT included. Fewer rooms costs less; your exact price takes two minutes.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {examples.map((ex) => (
                <div key={ex.label} className="rounded-2xl border border-line bg-white p-5">
                  <p className="font-semibold">{ex.label}</p>
                  <p className="mt-2 text-3xl font-display">{gbp(ex.price)}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    Indicative, whole-home · fixed once you confirm your details
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-display">Why street by street?</h2>
          <p className="mt-3 leading-relaxed text-ink-700">
            Because your neighbour&apos;s house is your house. Installing down one street at a
            time means the survey answers, pipe routes and planning quirks from three doors down
            make your installation faster and your price sharper. It also means our engineers are
            local on the day, not fighting the South Circular.
          </p>
          <div className="mt-8 rounded-2xl border border-accent-100 bg-accent-50 p-6">
            <p className="font-semibold">Ready when you are</p>
            <p className="mt-1 text-sm text-ink-500">
              Start with your postcode and see your fixed price in about two minutes.
            </p>
            <Link
              href="/quote"
              className="mt-4 inline-block rounded-full bg-accent-600 px-5 py-2.5 font-semibold text-white transition hover:bg-accent-700"
            >
              Start my survey
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
