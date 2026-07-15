import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

export const metadata: Metadata = {
  title: "How it works",
};

const sections = [
  {
    title: "1. You survey your own home",
    body: "Our guided survey walks you through your home room by room: how big each room is, which way it faces, where your fuse board is, where the outdoor unit could live. You photograph each one from your phone, the camera opens automatically. It replaces the traditional salesperson visit entirely.",
  },
  {
    title: "2. We size the system properly",
    body: "Behind the scenes, a heat-load model estimates the cooling each room needs from its size, glazing, orientation and use, then picks the smallest unit that comfortably covers it. Oversized units short-cycle and waste money; undersized ones never keep up. Sizing is the bit the industry most often gets wrong, so we automated it.",
  },
  {
    title: "3. Your price is fixed, with a confidence score",
    body: "Every quote comes with an Installation Confidence Score. A complete survey with photos scores high, and a high score means the price is guaranteed as-is. Missing details lower the score, and we tell you exactly what to add to lock it in. No on-the-day surprises, because the surprises got answered before we arrived.",
  },
  {
    title: "4. Installation, documented end to end",
    body: "Our engineers arrive with a job pack generated from your survey: unit positions, pipe routes, electrical work. Each installation step is photographed and quality-checked (pressure tests, vacuum readings, commissioning data) and your handover documents generate automatically.",
  },
  {
    title: "5. It keeps working for years",
    body: "Modern systems heat as well as cool, and ours are monitored: energy use, runtime and error codes flow into your customer portal. Instead of a blanket annual service charge, we tell you when your system actually needs attention.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="warm-gradient">
          <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
            <h1 className="text-4xl font-display sm:text-5xl">How it works</h1>
            <p className="mt-4 text-lg text-ink-500">
              We rebuilt the whole journey, from &ldquo;how much would it
              cost?&rdquo; to a quietly humming system, around one idea: answer
              every question before an engineer sets foot in your home.
            </p>
          </div>
        </section>
        <section className="mx-auto max-w-3xl space-y-10 px-4 py-16 sm:px-6">
          {sections.map((s) => (
            <div key={s.title}>
              <h2 className="text-xl font-bold">{s.title}</h2>
              <p className="mt-2 leading-relaxed text-ink-500">{s.body}</p>
            </div>
          ))}
          <div className="rounded-3xl border border-accent-100 bg-accent-50 p-8 text-center">
            <h2 className="text-2xl font-bold">See your price</h2>
            <p className="mx-auto mt-2 max-w-md text-ink-500">
              Ten minutes, your phone, and a guaranteed fixed price at the end.
            </p>
            <Link
              href="/quote"
              className="mt-5 inline-block rounded-full bg-accent-600 px-6 py-3 font-semibold text-white transition hover:bg-accent-700"
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
