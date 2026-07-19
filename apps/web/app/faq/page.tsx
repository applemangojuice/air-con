import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Planning permission, noise, running costs, install day, warranty: every question about home air conditioning, answered straight.",
};

/**
 * The questions people actually ask before buying home air conditioning in
 * the UK, answered honestly. Rendered with FAQPage structured data so search
 * engines can show the answers directly.
 */
const faqs: { q: string; a: string }[] = [
  {
    q: "Do I need planning permission for air conditioning?",
    a: "Usually not. Most houses can install an outdoor unit under permitted development, as long as it meets size and placement rules (which our designs follow by default). Flats, listed buildings and conservation areas are different — if public records suggest your address needs a check, your quote says so upfront rather than on install day.",
  },
  {
    q: "How much does home air conditioning cost to install?",
    a: "A single room typically starts around £2,000 installed; a whole-house multi-split system for a three-bedroom home is usually £6,000–£10,000 depending on rooms and routing. Ours is a fixed price, not an estimate: complete the two-minute survey and the price you see is the price you pay.",
  },
  {
    q: "What does it cost to run?",
    a: "Modern inverter systems are extremely efficient. Cooling a bedroom overnight typically costs 20–40p at current electricity prices; a living room on a hot afternoon under £1. In winter the same unit heats at roughly a third of the cost of a plug-in electric heater, because heat pumps move heat rather than generate it.",
  },
  {
    q: "Is it noisy?",
    a: "Indoor units run at a whisper — around 19–26 dB on night mode, quieter than a library. The outdoor unit is about as loud as a fridge and we position it away from bedrooms (yours and your neighbours') as part of the design.",
  },
  {
    q: "Does it heat as well as cool?",
    a: "Yes. Every system we install is a heat pump: cooling in summer, efficient heating in winter, and air filtration all year. Many customers end up using it as their main heating in the rooms it serves.",
  },
  {
    q: "How long does installation take?",
    a: "Most single-unit installs are done in a day; whole-house systems typically take two. Your quote includes the expected duration, and everything is documented: pressure tests, vacuum readings and commissioning data, with certificates handed over at the end.",
  },
  {
    q: "How accurate is the online price, really?",
    a: "Every quote carries an Installation Confidence Score. Complete the survey with photos and the score is high — that price is guaranteed as-is. If something on the day materially differs from your survey, we explain and agree any change before starting work, and you can cancel at no cost if you don't accept it.",
  },
  {
    q: "What warranty do I get?",
    a: "Five years, parts and labour, on every installation as standard — on top of your statutory consumer rights, not instead of them.",
  },
  {
    q: "Do I need my landlord's or freeholder's permission?",
    a: "If you rent, yes — you'll need your landlord's written consent. If you own a leasehold flat, your lease usually requires freeholder consent for the outdoor unit. We flag this in your quote and can provide the technical details consent requests usually ask for.",
  },
  {
    q: "Which areas do you cover?",
    a: "We're rolling out street by street across South London, starting with SW16 and SW17. Enter your postcode and we'll tell you straight away whether we cover you — and if we don't yet, your quote is still real and we'll tell you when we arrive in your area.",
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

export default function FaqPage() {
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
            <h1 className="text-4xl font-display sm:text-5xl">Fair questions</h1>
            <p className="mt-4 text-lg text-ink-500">
              Everything people ask before putting air conditioning in their
              home, answered without the salesperson gloss.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="space-y-3">
            {faqs.map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl border border-line bg-white p-5 open:shadow-sm"
              >
                <summary className="cursor-pointer list-none font-semibold text-ink-900 marker:content-none">
                  <span className="flex items-center justify-between gap-3">
                    {f.q}
                    <span
                      aria-hidden
                      className="shrink-0 text-accent-600 transition group-open:rotate-45"
                    >
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-3 leading-relaxed text-ink-500">{f.a}</p>
              </details>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-accent-100 bg-accent-50 p-6">
            <p className="font-semibold">Something we haven&apos;t answered?</p>
            <p className="mt-1 text-sm text-ink-500">
              Email{" "}
              <a
                href={`mailto:${BRAND.supportEmail}`}
                className="font-semibold text-accent-700 hover:underline"
              >
                {BRAND.supportEmail}
              </a>{" "}
              and a human replies. Or just get your price — it&apos;s free and
              answers most questions by itself.
            </p>
            <Link
              href="/quote"
              className="mt-4 inline-block rounded-full bg-accent-600 px-5 py-2.5 font-semibold text-white transition hover:bg-accent-700"
            >
              Get my fixed price
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
