import Link from "next/link";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { BRAND } from "@/lib/brand";

const steps = [
  {
    n: "01",
    title: "Survey your home from your phone",
    body: "Answer a few questions and photograph each room, your outdoor space and your fuse board. It takes about 10 minutes — no visit needed.",
  },
  {
    n: "02",
    title: "Get a fixed price instantly",
    body: "Our pricing engine sizes the right units for every room and returns a guaranteed installation price with finance options — not an estimate.",
  },
  {
    n: "03",
    title: "Book your installation online",
    body: "Pick a date, pay a deposit, and track everything in your portal. Most homes are installed in a single day.",
  },
];

const promises = [
  { title: "Fixed price, guaranteed", body: "The price you see is the price you pay. No surveyor upsell, no on-the-day extras." },
  { title: "5-year warranty", body: "Parts and labour included on every installation as standard." },
  { title: "Certified engineers", body: "Every install by F-Gas certified engineers, photographed and quality-checked at each step." },
  { title: "Cooling and heating", body: "Modern systems heat efficiently in winter too — one unit, year-round comfort." },
];

const platform = [
  { title: "Customer portal", body: "Quotes, contracts, installation progress and documents in one place.", href: "/portal", status: "In progress" },
  { title: "Operations & CRM", body: "Leads, pipeline, design review and scheduling for the internal team.", href: "/ops", status: "Planned" },
  { title: "Installer app", body: "Job packs, step-by-step workflows and photo-verified quality assurance.", href: "/ops#installer", status: "Planned" },
  { title: "Smart monitoring", body: "Energy use, running costs and predictive maintenance for every system.", href: "/ops#monitoring", status: "Planned" },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="air-gradient">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-2 rounded-full border border-air-100 bg-white px-3 py-1 text-xs font-semibold text-air-700">
                <span className="h-1.5 w-1.5 rounded-full bg-air-500" />
                Now taking bookings — limited launch areas
              </p>
              <h1 className="mt-5 text-4xl font-bold tracking-tight text-ink-900 sm:text-6xl">
                Air conditioning for your home.{" "}
                <span className="text-air-600">Priced in minutes.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-ink-500">
                Survey your own home from your phone and get a guaranteed fixed
                price for a professional installation — no salesperson, no
                waiting a week for a surveyor.
              </p>

              <form action="/quote" className="mt-8 flex max-w-md gap-2">
                <input
                  type="text"
                  name="postcode"
                  required
                  placeholder="Your postcode, e.g. SW1A 1AA"
                  autoComplete="postal-code"
                  className="w-full rounded-xl border border-line bg-white px-4 py-3 text-base shadow-sm outline-none transition focus:border-air-500 focus:ring-2 focus:ring-air-100"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-xl bg-ink-900 px-5 py-3 font-semibold text-white transition hover:bg-ink-700"
                >
                  Start
                </button>
              </form>
              <p className="mt-3 text-sm text-ink-300">
                Free, takes ~10 minutes, and your price is fixed — not an estimate.
              </p>
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            From “maybe” to installed, in three steps
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="rounded-2xl border border-line bg-mist p-6">
                <span className="text-sm font-bold text-air-600">{s.n}</span>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Link
              href="/quote"
              className="inline-block rounded-xl bg-air-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-air-700"
            >
              Get my fixed price
            </Link>
          </div>
        </section>

        {/* Promises */}
        <section className="border-y border-line bg-mist">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
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
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            One platform, from first quote to year fifteen
          </h2>
          <p className="mt-3 max-w-2xl text-ink-500">
            {BRAND.name} manages the whole life of your system — quoting, design,
            installation, monitoring and servicing — so every step is faster,
            more predictable and better documented.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {platform.map((p) => (
              <Link
                key={p.title}
                href={p.href}
                className="group rounded-2xl border border-line p-6 transition hover:border-air-400 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold group-hover:text-air-700">{p.title}</h3>
                  <span className="rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-ink-500">
                    {p.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{p.body}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="ink-gradient">
          <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Ready to see your price?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-white/60">
              Ten minutes on your phone. A guaranteed price at the end. No
              obligation, no pushy calls.
            </p>
            <Link
              href="/quote"
              className="mt-8 inline-block rounded-xl bg-air-500 px-8 py-3.5 font-semibold text-white shadow-lg transition hover:bg-air-400"
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
