import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { BRAND } from "@/lib/brand";
import { examplePrices } from "@/lib/example-prices";
import { gbp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Air conditioning cost UK (2026): real installed prices",
  description:
    "What home air conditioning actually costs in the UK: per-room and whole-home installed prices, running costs per hour, and what's included in a fixed price.",
};

/**
 * The flagship cost page — the highest-intent organic keyword in the
 * category, and (per the benchmark research) a SERP no D2C air-con brand
 * dominates yet. Unfair advantage: every price here is computed by the same
 * engine that prices real quotes, at build time. Not researched averages —
 * our actual prices.
 */
export default function CostGuidePage() {
  const p = examplePrices();

  const table = [
    { config: "One bedroom", price: p.oneBedroom, note: "Wall-mounted unit, typical first-floor bedroom" },
    { config: "One living room", price: p.livingRoom, note: "Larger unit for a bigger, busier room" },
    { config: "Two rooms (bedroom + living room)", price: p.twoRooms, note: "Multi-split: two indoor units, one outdoor" },
    { config: "Whole 3-bed terrace", price: p.threeBedTerrace, note: "Every main room, one outdoor unit" },
    { config: "Whole 3-bed semi", price: p.threeBedSemi, note: "Semi-detached routing is often simpler" },
    { config: "Whole 4-bed home", price: p.fourBedHome, note: "Larger multi-split system" },
  ];

  const runningCosts = [
    { scenario: "Bedroom overnight (8h, cooling)", cost: "20–40p" },
    { scenario: "Living room, hot afternoon (4h)", cost: "40–80p" },
    { scenario: "Whole July heatwave week, one room", cost: "£3–£6" },
    { scenario: "Heating a room in winter (vs plug-in heater)", cost: "~⅓ of the cost" },
  ];

  const faqs = [
    {
      q: "How much does air conditioning cost to install in the UK?",
      a: `A single-room installation starts around ${gbp(Math.min(p.oneBedroom, p.livingRoom))} fully installed including VAT. A whole three-bed home is typically ${gbp(p.threeBedTerrace)}–${gbp(Math.max(p.threeBedSemi, p.fourBedHome))} depending on rooms and layout. These are our real fixed prices, not directory estimates.`,
    },
    {
      q: "What's included in a fixed installation price?",
      a: "Everything: the indoor and outdoor units, pipework and electrical connection, installation by F-Gas certified engineers, commissioning and certification, waste removal, VAT, and a 5-year parts and labour warranty. No on-the-day extras.",
    },
    {
      q: "How much does air conditioning cost to run?",
      a: "Modern inverter systems are extremely efficient: cooling a bedroom overnight typically costs 20–40p at current electricity prices. In winter the same unit heats at roughly a third of the cost of a plug-in electric heater.",
    },
    {
      q: "Why do quotes elsewhere vary so much?",
      a: "Most installers price each job bespoke after a sales visit, so quotes carry a 'fear premium' for the unknown. We pre-design installations for common London house types, which is why we can publish a fixed price online in two minutes.",
    },
    {
      q: "Is air conditioning worth it in the UK?",
      a: "London summers now regularly exceed 30°C, and modern systems heat efficiently in winter too — one unit, comfortable all year. Most of our customers use the heating mode as much as the cooling.",
    },
  ];

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <SiteHeader />
      <main>
        <section className="warm-gradient">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
            <h1 className="text-4xl font-display sm:text-5xl">
              What air conditioning actually costs in the UK
            </h1>
            <p className="mt-4 text-lg text-ink-500">
              Real installed prices, VAT included — computed by the same engine that prices every
              quote we give, not averaged from a directory. Updated automatically whenever our
              prices change.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-display">Installed prices by home</h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-xs font-semibold text-ink-500">
                  <th className="px-4 py-3">Configuration</th>
                  <th className="px-4 py-3">Fixed price, installed</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {table.map((row) => (
                  <tr key={row.config}>
                    <td className="px-4 py-3 font-semibold">{row.config}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-lg font-bold">{gbp(row.price)}</td>
                    <td className="px-4 py-3 text-ink-500">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-ink-500">
            Every price includes the units, installation by F-Gas certified engineers, electrical
            work, commissioning, VAT, and a 5-year parts &amp; labour warranty. Your exact price
            depends on your rooms — it takes two minutes to get:
          </p>
          <Link
            href="/quote"
            className="mt-4 inline-block rounded-full bg-accent-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-700"
          >
            Get my exact fixed price
          </Link>
        </section>

        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
            <h2 className="text-2xl font-display">What it costs to run</h2>
            <p className="mt-2 text-ink-500">
              The pleasant surprise: modern inverter systems sip electricity. At current prices
              (~28p/kWh):
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {runningCosts.map((r) => (
                <div key={r.scenario} className="rounded-2xl border border-line bg-white p-4">
                  <p className="text-2xl font-display">{r.cost}</p>
                  <p className="mt-1 text-sm text-ink-500">{r.scenario}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-300">
              Estimates for a typical modern single-split system; your usage and tariff vary.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-display">What moves the price</h2>
          <ul className="mt-4 space-y-3">
            {[
              ["Number of rooms", "Each indoor unit adds cost; the outdoor unit is shared, so per-room cost falls as you add rooms."],
              ["Pipe runs", "Longer routes between indoor and outdoor units mean more labour and materials. Terraces with rear access are usually simplest."],
              ["Room and glazing size", "Bigger or sunnier rooms need more capacity — a larger unit, not a different install."],
              ["Electrics", "A modern consumer unit with a spare way keeps things simple; older fuse boxes may need work first (we tell you before, never on the day)."],
              ["Wall type and floor", "Loft rooms and solid-wall Victorians route differently to 1930s cavity-wall semis — our surveys are designed around exactly these differences."],
            ].map(([k, v]) => (
              <li key={k} className="flex gap-2.5">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                <span>
                  <strong>{k}.</strong> <span className="text-ink-500">{v}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto max-w-3xl px-4 pb-12 sm:px-6">
          <h2 className="text-2xl font-display">Cost questions, answered straight</h2>
          <div className="mt-4 space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-2xl border border-line bg-white p-5">
                <summary className="cursor-pointer list-none font-semibold marker:content-none">
                  <span className="flex items-center justify-between gap-3">
                    {f.q}
                    <span aria-hidden className="shrink-0 text-accent-600 transition group-open:rotate-45">
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-ink-500">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-6 text-sm text-ink-500">
            More questions? The{" "}
            <Link href="/faq" className="font-semibold text-accent-700 hover:underline">
              full FAQ
            </Link>{" "}
            covers planning permission, noise, landlords and more — or email{" "}
            <a href={`mailto:${BRAND.supportEmail}`} className="font-semibold text-accent-700 hover:underline">
              {BRAND.supportEmail}
            </a>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
