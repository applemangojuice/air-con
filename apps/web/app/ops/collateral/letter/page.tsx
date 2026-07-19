import Link from "next/link";
import type { Metadata } from "next";
import {
  classifyProperty,
  defaultConfigFromIntel,
  generateQuote,
  prefillFromIntel,
} from "@aircon/domain";
import { BRAND, appHost, appUrl } from "@/lib/brand";
import { gbp } from "@/lib/format";
import { loadIntel } from "@/lib/intel-server";

export const metadata: Metadata = {
  title: "Mailing letter · collateral · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * The A4 mailing letter. Two modes:
 *  - no query: the TEMPLATE, with «merge fields» highlighted — hand this
 *    to the mail house alongside the CSV export from /ops/intel.
 *  - ?intel=<property id>: a real PROOF for one address, every field
 *    filled from the property record and the live pricing engine.
 * Print it (Cmd/Ctrl+P): app chrome disappears, the letter is the page.
 */
export default async function LetterPage({
  searchParams,
}: {
  searchParams: Promise<{ intel?: string }>;
}) {
  const { intel: intelId } = await searchParams;
  const intel = intelId ? await loadIntel(intelId) : null;

  // Merge data: real values for a proof, «placeholders» for the template.
  let m = {
    addressLine: "«address_line»",
    postcode: "«postcode»",
    area: "«outcode»",
    facts: [
      "«A fact about the house from public records»",
      "«Another fact — floor area, loft conversion, glazing»",
      "«The install pattern this street matches»",
    ],
    price: "«indicative_price»",
    link: "«personal_link»",
  };

  if (intel) {
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

    m = {
      addressLine: intel.address.line1,
      postcode: intel.address.postcode,
      area: intel.address.outcode,
      facts: [
        prefill.floorAreaM2 ? `Around ${prefill.floorAreaM2} m² of home to keep cool` : null,
        intel.planning.loftConversion
          ? "A loft conversion — the hottest room in London in July"
          : null,
        intel.epc?.glazingDescription?.toLowerCase().includes("double")
          ? "Double glazing, which holds the cool in nicely"
          : null,
        cls.archetypeName ? `A match for our “${cls.archetypeName}” install pattern` : null,
      ].filter(Boolean) as string[],
      price: quote ? gbp(quote.totalGbp) : "«indicative_price»",
      link: `${appUrl()}/a/${intel.id}`,
    };
  }

  return (
    <>
      {/* Screen-only toolbar */}
      <div className="no-print border-b border-line bg-surface px-4 py-3 text-sm">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <p className="text-ink-500">
            {intel ? (
              <>
                Proof for <strong>{m.addressLine}</strong> — print to PDF for the mail house.
              </>
            ) : (
              <>
                Template with <span className="font-semibold text-accent-700">«merge fields»</span>.
                Add <code>?intel=&lt;property-id&gt;</code> for a proof of a real address.
              </>
            )}
          </p>
          <Link href="/ops/collateral" className="font-semibold text-accent-700 hover:underline">
            ← Collateral
          </Link>
        </div>
      </div>

      {/* The letter: A4-shaped on screen, the page itself in print */}
      <main className="print-exact mx-auto my-8 max-w-3xl bg-white px-12 py-14 shadow-lg print:my-0 print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <header className="flex items-start justify-between">
          <p className="text-2xl font-bold">
            {BRAND.nameLead} <span className="text-accent-500">{BRAND.nameHot}</span>
          </p>
          <div className="text-right text-xs leading-relaxed text-ink-500">
            <p>{BRAND.legalName}</p>
            <p>{BRAND.supportEmail}</p>
            <p>{appHost()}</p>
          </div>
        </header>

        <p className="mt-10 text-sm leading-relaxed text-ink-700">
          The homeowner
          <br />
          {m.addressLine}
          <br />
          London {m.postcode}
        </p>

        <h1 className="mt-8 text-2xl font-display leading-snug">
          We&apos;ve already designed the air conditioning for {m.addressLine}.
        </h1>

        <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-ink-900">
          <p>
            We&apos;re {BRAND.name}, and we install proper air conditioning in {m.area} — cooling
            in summer, efficient heating in winter — street by street, so every install benefits
            from the last one three doors down.
          </p>
          <p>
            Before writing to you, we did our homework from public records (all of it explained,
            and correctable, at the link below). About your home, we already know:
          </p>
          <ul className="ml-5 list-disc space-y-1.5">
            {m.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p>
            That was enough to design the system and price it. For a home like yours, whole-home
            comfort installed is typically <strong>{m.price}</strong>, VAT included — a fixed
            price, not an estimate, and it comes down if you want fewer rooms.
          </p>
          <p>
            Your home&apos;s page — what we know, what we&apos;d fit, and your price — is saved
            here:
          </p>
          <p className="rounded-xl bg-surface px-4 py-3 text-center font-semibold">{m.link}</p>
          <p>
            Two minutes there confirms the details and locks your price. No salesperson visits, no
            phone calls, nobody &ldquo;popping by while they&apos;re in the area&rdquo;.
          </p>
        </div>

        <p className="mt-8 text-[15px]">
          Stay cool,
          <br />
          <span className="font-semibold">The {BRAND.name} team</span>
        </p>

        <footer className="mt-10 border-t border-line pt-4 text-[11px] leading-relaxed text-ink-500">
          Everything above comes from public records (the government EPC register and planning
          data) — nothing about you personally. If anything&apos;s wrong you can correct it at the
          link, and if you&apos;d rather not hear from us again, write RETURN on this letter and
          post it back, or email {BRAND.supportEmail}, and we&apos;ll take this address off the
          list for good.
        </footer>
      </main>
    </>
  );
}
