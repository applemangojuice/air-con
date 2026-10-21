import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  classifyProperty,
  prefillFromIntel,
  type PropertyEra,
  type PropertyType,
} from "@aircon/domain";
import { Logo } from "@/components/site/logo";
import { gbp } from "@/lib/format";
import { indicativeQuoteFromIntel } from "@/lib/intel-quote";
import { loadIntel, isSampleIntel } from "@/lib/intel-server";

export const metadata: Metadata = {
  title: "Air conditioning for your home",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<PropertyType, string> = {
  detached: "detached house",
  "semi-detached": "semi-detached house",
  terraced: "terraced house",
  flat: "flat",
  bungalow: "bungalow",
};

const ERA_LABEL: Record<PropertyEra, string> = {
  "pre-1930": "built before 1930",
  "1930-1950": "built in the 1930s or 40s",
  "1950-2000": "built between the 50s and 90s",
  "2000+": "built after 2000",
};

/**
 * The per-address page. Each mailing carries its own link (/a/<property id>),
 * landing on a page about that exact home: what we already know, the system
 * we'd propose, and an indicative price. The CTA drops into the quote funnel
 * with everything pre-filled.
 */
export default async function AddressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9-]{1,80}$/i.test(id)) notFound();
  const intel = await loadIntel(id);
  if (!intel) notFound();
  // The demo sample (and a sample book loaded into a demo database): made-up facts, labelled DEMO.
  const sample = isSampleIntel(intel);

  const cls = classifyProperty(intel);
  const prefill = prefillFromIntel(intel);
  const indicative = indicativeQuoteFromIntel(intel);

  const funnelHref = `/quote?intel=${encodeURIComponent(intel.id)}&postcode=${encodeURIComponent(intel.address.postcode)}`;

  const knownFacts = [
    prefill.type && prefill.era ? `A ${TYPE_LABEL[prefill.type]}, ${ERA_LABEL[prefill.era]}` : null,
    prefill.floorAreaM2 ? `Around ${prefill.floorAreaM2} m² of home to keep cool` : null,
    intel.epc?.habitableRooms ? `${intel.epc.habitableRooms} habitable rooms` : null,
    intel.planning.loftConversion
      ? "A loft conversion, and lofts are the hottest rooms in London"
      : null,
    intel.planning.rearExtension ? "A rear extension" : null,
    intel.epc?.glazingDescription?.toLowerCase().includes("double")
      ? "Double glazing, which holds the cool in nicely"
      : null,
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-dvh bg-cream">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4 sm:px-0">
          <Link href="/" aria-label="Homepage">
            <Logo />
          </Link>
          <span className="text-xs font-medium text-ink-300">Prepared for your address</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 pb-24 pt-10 sm:px-0">
        <p className="text-sm font-semibold text-accent-700">
          {intel.address.line1}, {intel.address.postcode}
        </p>
        {sample && (
          <p role="note" className="mt-3 rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            DEMO: a sample page. This address and these facts are made up for the demo, not public records.
          </p>
        )}
        <h1 className="mt-2 text-3xl font-display sm:text-4xl">
          Air conditioning for your home: an estimate from public records
        </h1>
        <p className="mt-3 text-ink-500">
          We install in {intel.address.outcode}. Here&apos;s what public records say about your home, and what
          we&apos;d expect to fit. It&apos;s an estimate: a home survey and our engineer&apos;s design come next,
          and the price is only fixed then. Where every fact comes from is explained at the bottom.
        </p>

        {/* What we know */}
        <section className="mt-8 rounded-sm border border-line bg-white p-6">
          <h2 className="font-bold">{sample ? "Sample facts (DEMO)" : "Your home, from public records"}</h2>
          <ul className="mt-3 space-y-2">
            {knownFacts.map((fact) => (
              <li key={fact} className="flex gap-2.5 text-sm text-ink-700">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                {fact}
              </li>
            ))}
          </ul>
          {cls.archetypeName && (
            <p className="mt-4 rounded-sm bg-surface/60 px-4 py-3 text-sm text-ink-700">
              Homes like yours match our <strong>{cls.archetypeName}</strong> pattern: a starting point for
              the estimate. Our engineer designs your system after the survey.
            </p>
          )}
          {cls.planningRisk === "check" && (
            <p className="mt-3 text-xs text-ink-500">
              Your street sits in a conservation area. Outdoor units usually stay fine at the rear,
              and we check the exact rules for you before anything is booked.
            </p>
          )}
        </section>

        {/* Proposed system + price */}
        {indicative && (
          <section className="mt-6 rounded-sm border border-line bg-white p-6">
            <h2 className="font-bold">What we&apos;d propose</h2>
            <ul className="mt-3 space-y-2">
              {indicative.rooms.map((room) => (
                <li key={room.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{room.name}</span>
                  <span className="rounded-sm bg-sage-50 px-2.5 py-0.5 text-xs font-semibold text-sage-700">
                    cooled + heated
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-sm bg-surface/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
                Indicative price, installed
              </p>
              <p className="mt-1 text-3xl font-display">{gbp(indicative.quote.totalGbp)}</p>
              <p className="mt-1 text-xs text-ink-500">
                An estimate from public records. Check the details for your price; a home survey confirms it.
              </p>
            </div>
          </section>
        )}

        <Link
          href={funnelHref}
          className="mt-8 block w-full rounded-sm bg-accent-700 px-5 py-3.5 text-center font-semibold text-white shadow-sm transition hover:bg-accent-800"
        >
          Check the details, get my price
        </Link>
        <p className="mt-2 text-center text-xs text-ink-300">
          Two minutes, everything pre-filled. No salesperson, no phone calls.
        </p>

        <p className="mt-10 text-xs leading-relaxed text-ink-300">
          The facts above come from public records (the government EPC register and planning
          data). If something looks wrong you can correct it in the survey, and if you&apos;d
          rather we didn&apos;t write to this address again, reply RETURN on your letter or email
          us and we&apos;ll take it off the list.
        </p>
      </main>
    </div>
  );
}
