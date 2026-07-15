import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  classifyProperty,
  defaultConfigFromIntel,
  generateQuote,
  prefillFromIntel,
  type PropertyEra,
  type PropertyType,
} from "@aircon/domain";
import { Logo } from "@/components/site/logo";
import { gbp } from "@/lib/format";
import { loadIntel } from "@/lib/intel-server";

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

  const cls = classifyProperty(intel);
  const prefill = prefillFromIntel(intel);
  const config = defaultConfigFromIntel(intel);
  const quote =
    config && prefill.type && prefill.era
      ? generateQuote({
          postcode: intel.address.postcode,
          addressLine: intel.address.line1,
          archetypeId: config.archetypeId,
          permutationId: config.permutationId,
          property: {
            type: prefill.type,
            era: prefill.era,
            bedrooms: prefill.bedrooms ?? 3,
            ownership: "owner",
          },
          rooms: config.rooms,
          outdoor: { location: config.outdoorDefault, photos: [] },
          electrics: { condition: "unsure", photos: [] },
        })
      : null;

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
        <h1 className="mt-2 text-3xl font-display sm:text-4xl">
          Air conditioning, already designed for your home
        </h1>
        <p className="mt-3 text-ink-500">
          We install street by street in {intel.address.outcode}, and we&apos;ve done our homework
          on homes like yours before knocking. Here&apos;s what we know already.
        </p>

        {/* What we know */}
        <section className="mt-8 rounded-3xl border border-line bg-white p-6">
          <h2 className="font-bold">Your home, from public records</h2>
          <ul className="mt-3 space-y-2">
            {knownFacts.map((fact) => (
              <li key={fact} className="flex gap-2.5 text-sm text-ink-700">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />
                {fact}
              </li>
            ))}
          </ul>
          {cls.archetypeName && (
            <p className="mt-4 rounded-2xl bg-surface/60 px-4 py-3 text-sm text-ink-700">
              Homes like yours match our <strong>{cls.archetypeName}</strong> install pattern. We
              fit it week in, week out, so the design work is already done.
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
        {quote && config && (
          <section className="mt-6 rounded-3xl border border-line bg-white p-6">
            <h2 className="font-bold">What we&apos;d propose</h2>
            <ul className="mt-3 space-y-2">
              {config.rooms.map((room) => (
                <li key={room.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{room.name}</span>
                  <span className="rounded-full bg-sage-50 px-2.5 py-0.5 text-xs font-semibold text-sage-700">
                    cooled + heated
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-2xl bg-surface/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
                Indicative fixed price, installed
              </p>
              <p className="mt-1 text-3xl font-display">{gbp(quote.totalGbp)}</p>
              <p className="mt-1 text-xs text-ink-500">
                Locks in once you confirm a few details. It can come down if you want fewer rooms.
              </p>
            </div>
          </section>
        )}

        <Link
          href={funnelHref}
          className="mt-8 block w-full rounded-full bg-accent-600 px-5 py-3.5 text-center font-semibold text-white shadow-sm transition hover:bg-accent-700"
        >
          Check the details, get my fixed price
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
