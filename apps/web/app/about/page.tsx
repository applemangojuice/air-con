import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Dang, It's Hot is named after our founder, Jason Dang. We're redesigning how residential air conditioning is delivered in the UK, from the ground up.",
};

const pillars = [
  {
    title: "Fixed prices, not estimates",
    body: "You see the actual price online in under two minutes, and it's the price you pay. No surveyor visit to get a number, no on-the-day extras.",
  },
  {
    title: "A guided digital survey",
    body: "You tell us about your home from your phone, and if we already know your address most of it is filled in for you. The questions a salesperson would ask, without the salesperson.",
  },
  {
    title: "One clear timeline",
    body: "Quote, floor plan, site visit, delivery, install day: every step on one page with real dates you book yourself, and commitments we pay out on automatically if we miss them.",
  },
  {
    title: "Engineering underneath",
    body: "Standardised installations, specialist tooling, trained employees, optimised logistics, and software that gets a little smarter with every install we complete.",
  },
];

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold text-accent-700">About us</p>
        <h1 className="mt-2 text-4xl font-display sm:text-5xl">
          Yes, it&apos;s really our name
        </h1>

        <div className="mt-8 overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/dang-its-hot.webp"
            alt="The Dang, It's Hot team on Clapham Common, with the van and the dog who thinks he runs the place."
            className="w-full"
          />
        </div>

        <div className="mt-10 space-y-5 text-lg leading-relaxed text-ink-700">
          <p>
            Dang, It&apos;s Hot is named after our founder, Jason Dang. It&apos;s a pun, it&apos;s
            his surname, and it&apos;s the exact sentence every Londoner says three or four times
            each summer now. We figured a company should say what everyone&apos;s thinking.
          </p>
          <p>
            Jason grew up in London, in homes like most of the city&apos;s: built to trap heat,
            because for a hundred years heat was the thing worth trapping. Then the summers
            changed. Top-floor bedrooms that never dropped below 28°. Fans pointed at beds. Wet
            towels on radiators. Sleepless August nights that everyone treats as normal, and
            shouldn&apos;t be. British homes weren&apos;t designed for the weather they now get,
            and the weather isn&apos;t going back.
          </p>
          <p>
            That&apos;s the conviction the company is built on: the UK is at the start of a
            long-term shift in home cooling. Air conditioning here is where double glazing was in
            the seventies and central heating before that, a luxury that becomes an expectation
            within a generation. Millions of homes will make this improvement. The only question
            is who they&apos;ll trust to do it.
          </p>
          <p>
            Today, getting air conditioning installed means finding a local trade, waiting weeks
            for a survey, receiving a &ldquo;quote&rdquo; that&apos;s really an estimate, and hoping
            the day goes to plan. The installers are often skilled; the experience is stuck in
            1995. We&apos;re not trying to do that job slightly better.{" "}
            <strong className="text-ink-900">
              We&apos;re redesigning how residential air conditioning is delivered, from the
              ground up.
            </strong>
          </p>
          <p>
            That means a technology-first installation company rather than another trade: fixed
            prices computed from real data about your actual house, a survey you do from your
            sofa, a timeline you control, and installations engineered like a product instead of
            improvised like a job. Buying air conditioning should feel like ordering broadband,
            and the install should feel like it was rehearsed, because for your house type, it
            was.
          </p>
          <p>
            Long term we&apos;re building a consumer brand, not a directory listing: our own
            products, smart-home integration, remote monitoring that tells you when your system
            needs attention instead of billing you annually to check. Every install feeds the
            software that plans the next one. That&apos;s the company: cooling as a modern
            product, delivered properly.
          </p>
        </div>

        <h2 className="mt-12 text-2xl font-display">What that looks like in practice</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {pillars.map((p) => (
            <div key={p.title} className="rounded-2xl border border-line bg-white p-5">
              <h3 className="font-semibold">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{p.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-3xl border border-accent-100 bg-accent-50 p-6">
          <p className="text-lg font-display">Keeping London cool, street by street.</p>
          <p className="mt-2 text-sm text-ink-700">
            We&apos;re starting deep in South London rather than shallow everywhere, and yes, the dog
            on the van makes the important decisions.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Link
              href="/quote"
              className="inline-block rounded-full bg-accent-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-700"
            >
              Get my fixed price
            </Link>
            <Link href="/how-it-works" className="text-sm font-semibold text-accent-700 hover:underline">
              See our process, with a live example →
            </Link>
          </div>
          <p className="mt-3 text-xs text-ink-500">Or say hello: {BRAND.supportEmail}</p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
