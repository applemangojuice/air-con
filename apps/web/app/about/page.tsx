import Link from "next/link";
import type { Metadata } from "next";
import { BrandArt } from "@/components/site/brand-art";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { primaryBtn } from "@/components/site/styles";
import { getPublicSettings } from "@/lib/public-settings";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "About us",
  description:
    "Dang, It's Hot is named after our founder, Jason Dang. We're starting out in London, heating and cooling homes with a price up front and every step in writing.",
};

const pillars = [
  {
    title: "Your price up front",
    body: "You see a real price online in about two minutes, before anyone visits. A home survey then confirms it, and if anything changes, your proposal says exactly why.",
  },
  {
    title: "A proper survey",
    body: "We measure every room, photograph where the units and pipes would go, and check your fuse board, so your design starts from your house, not a guess.",
  },
  {
    title: "One clear timeline",
    body: "Price, survey, proposal, booking, kit, install, handover: every step on one page, with real dates and nothing marked done until it is.",
  },
  {
    title: "Done properly, and written down",
    body: "Every step of every install is photographed, measured and checked against a list. What we learn on one job goes into the checklist for the next.",
  },
];

export default async function AboutPage() {
  const settings = await getPublicSettings();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold text-accent-700">About us</p>
        <h1 className="mt-2 text-4xl font-display sm:text-5xl">Yes, it&apos;s really our name</h1>

        <BrandArt className="mt-8" />

        <div className="mt-10 space-y-5 text-lg leading-relaxed text-ink-700">
          <p>
            Dang, It&apos;s Hot is named after our founder, Jason Dang. It&apos;s a pun, it&apos;s his surname, and
            it&apos;s the exact sentence every Londoner says three or four times each summer now. We figured a
            company should say what everyone&apos;s thinking.
          </p>
          <p>
            Jason grew up in London, in homes like most of the city&apos;s: built to trap heat, because for a
            hundred years heat was the thing worth trapping. Then the summers changed. Top-floor bedrooms that never
            dropped below 28°. Fans pointed at beds. Sleepless August nights that everyone treats as normal, and
            shouldn&apos;t. British homes weren&apos;t designed for the weather they now get.
          </p>
          <p>
            The answer most people reach for is air conditioning. What fewer people know is that the same unit, an
            air-to-air heat pump, also heats your home efficiently in winter. So we&apos;re not selling a summer
            luxury: we&apos;re fitting one system that keeps a room comfortable all year.
          </p>
          <p>
            Getting it installed today usually means finding a local trade, waiting for a visit, getting a
            &ldquo;quote&rdquo; that&apos;s really an estimate, and hoping the day goes to plan. The installers are
            often skilled; the experience is stuck in 1995.{" "}
            <strong className="text-ink-900">We want it to feel as clear as ordering broadband.</strong> Your price
            online first, a proper survey to confirm it, a timeline you can see, and an install that&apos;s
            documented step by step.
          </p>
          <p>
            We&apos;re starting small and local: our first homes are in a handful of London postcodes, few enough that every one gets our
            full attention. Longer term we want to look after the whole life of your system, not just the install day.
          </p>
        </div>

        <h2 className="mt-12 text-2xl font-display">What that looks like in practice</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {pillars.map((p) => (
            <div key={p.title} className="rounded-sm border border-line bg-white p-5">
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-700">{p.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-sm border border-accent-100 bg-accent-50 p-6">
          <p className="text-lg font-display">Keeping London comfortable, street by street.</p>
          <p className="mt-2 text-sm text-ink-700">
            We&apos;re starting deep in a few postcodes rather than shallow everywhere. And yes, the dog in the
            drawing makes the important decisions.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Link href="/quote" className={primaryBtn}>
              Get my price
            </Link>
            <Link href="/faq" className="text-sm font-semibold text-accent-700 underline-offset-2 hover:underline">
              Read the FAQ
            </Link>
          </div>
          <p className="mt-3 text-sm text-ink-700">
            Or say hello: <a href={`mailto:${settings.company.email}`} className="font-semibold underline">{settings.company.email}</a>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
