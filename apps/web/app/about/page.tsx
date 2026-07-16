import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Dang, It's Hot started on Clapham Common in a heatwave. Cooling technologies for the UK, installed street by street.",
};

const services = [
  {
    icon: "❄️",
    title: "Air conditioning installation",
    body: "The main event. Fixed-price, template-built installs for London homes, priced online in under two minutes and fitted in a day.",
  },
  {
    icon: "💧",
    title: "Water sprays & misting systems",
    body: "Gardens, terraces and outdoor spaces that stay usable in August. Simple systems, properly plumbed.",
  },
  {
    icon: "🌀",
    title: "Ventilation solutions",
    body: "Moving air the smart way: extract, circulation and fresh-air systems for the rooms that never cool down on their own.",
  },
];

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold text-accent-700">About us</p>
        <h1 className="mt-2 text-4xl font-display sm:text-5xl">
          It started on Clapham Common, in a heatwave
        </h1>

        <div className="mt-8 overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/dang-its-hot.webp"
            alt="The Dang, It's Hot team, the dog who runs the place, and the van, on Clapham Common."
            className="w-full"
          />
        </div>

        <div className="mt-10 space-y-5 text-lg leading-relaxed text-ink-700">
          <p>
            Another 34° day, another night with the fan pointed at the bed and the freezer door
            open a bit too long. Everyone on the common that afternoon was saying the same three
            words, so we put them on the van:{" "}
            <strong className="text-ink-900">Dang, it&apos;s hot.</strong>
          </p>
          <p>
            British homes were built to keep heat in, and the summers stopped cooperating. Getting
            air conditioning fitted meant weeks of waiting for surveyors, quotes that were
            actually estimates, and a price that changed on the day. We thought that was mad. Air
            conditioning should be as easy to buy as broadband: type your address, see the price,
            pick a date.
          </p>
          <p>
            So we built it that way. We studied the houses street by street, worked out that
            London really only has a handful of home types, and engineered a proven install for
            each one. That&apos;s why we can put a fixed price on your exact house in under two
            minutes, and why the fitting takes a day instead of a week.
          </p>
          <p>
            We&apos;re a small South London team: a couple of engineers, one very good little van
            (reg plate HOT 1), and a black cockapoo whose collar says CEO because, frankly, he
            makes all the important decisions. We install close to home on purpose. Depth before
            breadth: we&apos;d rather know SW16 and SW17 better than anyone alive than be average
            everywhere.
          </p>
        </div>

        <h2 className="mt-12 text-2xl font-display">What we do</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {services.map((s) => (
            <div key={s.title} className="rounded-2xl border border-line bg-white p-5">
              <span className="text-2xl" aria-hidden>
                {s.icon}
              </span>
              <h3 className="mt-2 font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-3xl border border-accent-100 bg-accent-50 p-6">
          <p className="text-lg font-display">Keeping London cool.</p>
          <p className="mt-2 text-sm text-ink-700">
            Every install we do teaches us a little more about the next one. That&apos;s the whole
            company in a sentence.
          </p>
          <Link
            href="/quote"
            className="mt-5 inline-block rounded-full bg-accent-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-700"
          >
            Get my fixed price
          </Link>
          <p className="mt-3 text-xs text-ink-500">
            Or say hello: {BRAND.supportEmail}
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
