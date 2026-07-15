import Link from "next/link";
import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

export const metadata: Metadata = {
  title: "Customer portal",
};

const upcoming = [
  { title: "Quote history & revisions", body: "Every version of your quote and design, side by side." },
  { title: "Contracts & deposit", body: "Sign, pay and track your balance online." },
  { title: "Installation progress", body: "Live tracker from booking through commissioning sign-off." },
  { title: "Documents & certificates", body: "Warranty, commissioning data and electrical certificates in one place." },
  { title: "Energy & running costs", body: "See what your system uses and what it costs to run." },
  { title: "Service & health", body: "We monitor your system and tell you when it actually needs attention." },
];

export default function PortalPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <span className="rounded-full bg-surface px-3 py-1 text-xs font-semibold text-ink-500">
          Coming soon
        </span>
        <h1 className="mt-4 text-4xl font-display">Your account</h1>
        <p className="mt-3 max-w-xl text-ink-500">
          The portal opens once you&apos;ve booked an installation. Everything
          about your system (quotes, contracts, progress, documents and
          monitoring) will live here. Your installation itself already runs on
          a live timeline:{" "}
          <Link href="/p/demo" className="font-semibold text-accent-700 underline">
            see a playable example
          </Link>
          .
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {upcoming.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line p-5">
              <h2 className="font-semibold">{f.title}</h2>
              <p className="mt-1.5 text-sm text-ink-500">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-accent-100 bg-accent-50 p-6">
          <p className="font-semibold">Haven&apos;t got a quote yet?</p>
          <p className="mt-1 text-sm text-ink-500">
            That&apos;s the first step, and it takes about two minutes.
          </p>
          <Link
            href="/quote"
            className="mt-4 inline-block rounded-full bg-accent-600 px-5 py-2.5 font-semibold text-white transition hover:bg-accent-700"
          >
            Get my fixed price
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
