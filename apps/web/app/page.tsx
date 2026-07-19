import Link from "next/link";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { PostcodeForm } from "@/components/site/postcode-form";
import { ResumeBanner } from "@/components/site/resume-banner";
import { BRAND } from "@/lib/brand";

const steps = [
  {
    n: "01",
    title: "Tell us about your home",
    body: "A few taps about your house. If we already know your address, most of it is filled in for you. Under two minutes to your price. No ladder, no loft, no small talk.",
  },
  {
    n: "02",
    title: "Get a fixed price instantly",
    body: "Our pricing engine sizes the right units for every room and returns a guaranteed installation price with finance options. Not an estimate, the actual price.",
  },
  {
    n: "03",
    title: "Book your installation online",
    body: "Pick a date, pay a deposit, and track everything in your portal. Most homes are installed in a single day. Kettle on, job done.",
  },
];

const promises = [
  { title: "Fixed price, guaranteed", body: "The price you see is the price you pay. No surveyor upsell, no on-the-day extras, no sharp intake of breath." },
  { title: "5-year warranty", body: "Parts and labour included on every installation as standard." },
  { title: "Certified engineers", body: "Every install by F-Gas certified engineers, photographed and quality-checked at each step. Boots wiped, mess binned." },
  { title: "Cooling and heating", body: "Modern systems heat efficiently in winter too. One unit, comfy all year." },
];

const platform = [
  { title: "Your project timeline", body: "Quote to install day on one timeline: dates, deliveries, your installer, all live.", href: "/p/demo", status: "Live" },
  { title: "Customer portal", body: "Quotes, contracts, installation progress and documents in one place.", href: "/portal", status: "In progress" },
  { title: "Installer app", body: "Job packs, step-by-step workflows and photo-verified quality assurance.", href: "/ops#installer", status: "Planned" },
  { title: "Smart monitoring", body: "Energy use, running costs and predictive maintenance for every system.", href: "/ops#monitoring", status: "Planned" },
];

/** LocalBusiness structured data: name, area, offer. Keeps search results rich. */
const businessJsonLd = {
  "@context": "https://schema.org",
  "@type": "HVACBusiness",
  name: BRAND.name,
  legalName: BRAND.legalName,
  description:
    "Fixed-price residential air conditioning: guided self-survey, instant guaranteed quote, certified installation.",
  email: BRAND.supportEmail,
  areaServed: { "@type": "City", name: "London" },
  url: process.env.NEXT_PUBLIC_APP_URL ?? "https://dang.ac",
  priceRange: "££",
  makesOffer: {
    "@type": "Offer",
    itemOffered: {
      "@type": "Service",
      name: "Home air conditioning installation",
      description: "Fixed-price installation with 5-year parts and labour warranty",
    },
  },
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(businessJsonLd) }}
      />
      <SiteHeader />
      <ResumeBanner />
      <main>
        {/* Hero: the collateral IS the header */}
        <section className="warm-gradient">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1fr_460px]">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-accent-100 bg-white px-3 py-1 text-xs font-semibold text-accent-700">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                Now taking bookings in our launch areas
              </p>
              <h1 className="mt-5 text-4xl font-display text-ink-900 sm:text-6xl">
                Dang, it&apos;s hot.{" "}
                <span className="text-accent-600">Let&apos;s fix that.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-ink-500">
                Proper air conditioning for your home, with a guaranteed fixed
                price in under two minutes. No salesperson, no waiting a week
                for a surveyor, no more sleeping on top of the duvet with a wet
                flannel. Keeping London cool, street by street.
              </p>

              <PostcodeForm />
              <p className="mt-3 text-sm text-ink-300">
                Free, under two minutes, and the price is the price. Not an
                estimate, not a &ldquo;from&rdquo;, not a man with a clipboard.
              </p>
            </div>
            <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/dang-its-hot.webp"
                alt="Dang, It's Hot: cooling technologies for the UK. Keeping London cool."
                className="h-auto w-full"
                width={1400}
                height={933}
                fetchPriority="high"
                decoding="async"
              />
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-3xl font-display sm:text-4xl">
            From “maybe” to installed, in three steps
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="rounded-2xl border border-line bg-surface p-6">
                <span className="text-sm font-bold text-accent-600">{s.n}</span>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Link
              href="/quote"
              className="inline-block rounded-full bg-accent-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-700"
            >
              Get my fixed price
            </Link>
          </div>
        </section>

        {/* Promises */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
            <h2 className="text-3xl font-display sm:text-4xl">Not your usual tradespeople</h2>
            <p className="mt-2 max-w-2xl text-ink-500">
              Professional to a fault, and all of it in writing. If we miss a
              commitment, money comes off your bill automatically.
            </p>
          </div>
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {promises.map((p) => (
              <div key={p.title}>
                <h3 className="font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Platform teaser */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-3xl font-display sm:text-4xl">
            One platform, from first quote to year fifteen
          </h2>
          <p className="mt-3 max-w-2xl text-ink-500">
            {BRAND.name} looks after the whole life of your system: quoting, design,
            installation, monitoring and servicing. Every step is faster,
            more predictable and better documented.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {platform.map((p) => (
              <Link
                key={p.title}
                href={p.href}
                className="group rounded-2xl border border-line p-6 transition hover:border-accent-400 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold group-hover:text-accent-700">{p.title}</h3>
                  <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-500">
                    {p.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{p.body}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* Areas + FAQ: internal links that also answer "do you cover me?" */}
        <section className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-display">Where we install</h2>
              <p className="mt-2 text-sm text-ink-500">
                Street by street across South London, starting where the terraces repeat and the
                summers cook.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/areas/sw16"
                  className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-accent-400 hover:text-accent-700"
                >
                  Streatham (SW16) →
                </Link>
                <Link
                  href="/areas/sw17"
                  className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:border-accent-400 hover:text-accent-700"
                >
                  Tooting (SW17) →
                </Link>
              </div>
              <p className="mt-3 text-xs text-ink-300">
                Elsewhere? Your quote is still real — start it and we&apos;ll tell you when we
                reach your street.
              </p>
            </div>
            <div>
              <h2 className="text-2xl font-display">The questions everyone asks</h2>
              <ul className="mt-3 space-y-2 text-sm text-ink-700">
                <li>Do I need planning permission? <span className="text-ink-300">Usually not.</span></li>
                <li>Is it noisy? <span className="text-ink-300">Quieter than a library.</span></li>
                <li>What about winter? <span className="text-ink-300">It heats too, efficiently.</span></li>
              </ul>
              <Link
                href="/faq"
                className="mt-4 inline-block text-sm font-semibold text-accent-700 hover:underline"
              >
                All ten answers, straight →
              </Link>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="ink-gradient">
          <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
            <h2 className="text-3xl font-display text-white sm:text-4xl">
              Ready to see your price?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-white/60">
              Two minutes on your phone. A guaranteed price at the end. No
              obligation, no pushy calls. Worst case, you go back to your fan
              knowing exactly what freedom costs.
            </p>
            <Link
              href="/quote"
              className="mt-8 inline-block rounded-full bg-accent-500 px-8 py-3.5 font-semibold text-white shadow-lg transition hover:bg-accent-400"
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
