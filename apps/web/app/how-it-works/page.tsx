import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { DemoHub } from "@/components/portal/demo-hub";
import { buildDemoProject } from "@/lib/project-service";
import { PRICE_PROMISE } from "@/components/site/claims";

export const metadata: Metadata = {
  title: "Our process",
};

export const dynamic = "force-dynamic";

const sections = [
  {
    title: "1. You tell us about your home",
    body: "Our guided questions walk you through your home room by room: how big each room is, which way it faces, where your fuse board is, where the outdoor unit could live. Add a few photos if you like. If we already know your address, some of it is pre-filled from public records.",
  },
  {
    title: "2. We size the system and give you a price",
    body: "Behind the scenes, a heat-load model estimates the cooling each room needs from its size, glazing, orientation and use, then picks the smallest unit that comfortably covers it. Oversized units short-cycle and waste money; undersized ones never keep up. Your price comes with a confidence score, so you can see how firm it is and what would firm it up.",
  },
  {
    title: "3. A home survey confirms it",
    body: PRICE_PROMISE,
  },
  {
    title: "4. Your design and proposal, in writing",
    body: "Our technical lead signs off the design: which units, where they go, how the pipes run. Your proposal sets out the price, what's included, the payment terms and your cancellation rights. Nothing starts until you accept it.",
  },
  {
    title: "5. Installation, documented end to end",
    body: "Our engineers arrive with a job pack built from your survey and design. Each installation step is photographed and checked (pressure tests, vacuum readings, commissioning readings), and your handover pack and certificates follow when the job is signed off.",
  },
  {
    title: "6. Looking after it afterwards",
    body: "Your project page keeps your documents, photos and warranty details in one place. Something not right? Report it there, with a photo, and we'll pick it up.",
  },
];

/**
 * "Our process": the example installation front and centre. The embedded
 * timeline below is the real product running a demo project, every step
 * clickable, exactly what a customer gets after their quote.
 */
export default function OurProcessPage() {
  const demoProject = buildDemoProject();

  return (
    <>
      <SiteHeader />
      <main>
        <section className="warm-gradient">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
            <h1 className="text-4xl font-display sm:text-5xl">Our process</h1>
            <p className="mt-4 text-lg text-ink-500">
              We rebuilt the whole journey, from &ldquo;how much would it
              cost?&rdquo; to a quietly humming system, around one idea: answer
              every question before an engineer sets foot in your home.
              Radical stuff, we know.
            </p>
          </div>
        </section>

        {/* The example installation, playable, right at the top */}
        <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl font-display">An example installation</h2>
              <span className="rounded-sm bg-ink-900 px-3 py-1 text-xs font-bold tracking-wide text-white">DEMO · playable</span>
            </div>
            <p className="mt-2 text-sm text-ink-500">
              This is the project page every customer gets, running a fictional DEMO home. Book the
              survey, accept the proposal, pick your dates; the &#9654; buttons play our side. Nothing
              is saved.
            </p>
          </div>
          <div className="mt-6 rounded-sm border border-line bg-cream p-4 sm:p-6 lg:p-8">
            <DemoHub initialProject={demoProject} />
          </div>
        </section>

        <section className="mx-auto max-w-3xl space-y-10 px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-display">How it works, step by step</h2>
          {sections.map((s) => (
            <div key={s.title}>
              <h3 className="text-xl font-bold">{s.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-500">{s.body}</p>
            </div>
          ))}
          <div className="rounded-sm border border-accent-100 bg-accent-50 p-8 text-center">
            <h2 className="text-2xl font-bold">See your price</h2>
            <p className="mx-auto mt-2 max-w-md text-ink-500">
              About two minutes on your phone. Your price is confirmed at your home survey.
            </p>
            <Link
              href="/quote"
              className="mt-5 inline-block rounded-sm bg-accent-700 px-6 py-3 font-semibold text-white transition hover:bg-accent-800"
            >
              Get my price
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
