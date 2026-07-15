import Link from "next/link";
import type { Metadata } from "next";
import {
  ARCHETYPES,
  buildPresetRoom,
  generateQuote,
  type HouseArchetype,
  type Survey,
} from "@aircon/domain";
import { gbp } from "@/lib/format";
import { queryIntel } from "@/lib/intel-server";

export const metadata: Metadata = {
  title: "Template library · admin",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const FLOOR_LABEL: Record<string, string> = {
  ground: "Ground",
  first: "First",
  "second-plus": "Second+",
  loft: "Loft",
};

/**
 * The installation template library: every archetype we classify homes into
 * and every pre-engineered install pattern we fit. This is where you test
 * the layouts: each archetype shows its stock floor plan, its patterns with
 * adders and pre-checks, a sample fixed price from the live engine, and how
 * many homes in the book currently match it.
 */
export default async function TemplatesPage() {
  const book = await queryIntel({});
  const countByArchetype = new Map<string, number>();
  for (const row of book) {
    if (row.archetype_id) {
      countByArchetype.set(row.archetype_id, (countByArchetype.get(row.archetype_id) ?? 0) + 1);
    }
  }

  const totalPermutations = ARCHETYPES.reduce((n, a) => n + a.permutations.length, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Template library</h1>
          <p className="mt-1 text-sm text-ink-500">
            {ARCHETYPES.length} archetypes · {totalPermutations} install patterns. Design is
            selection, not invention: every quote picks from this page.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← Console
        </Link>
      </div>

      <div className="space-y-6">
        {ARCHETYPES.map((archetype) => (
          <ArchetypeCard
            key={archetype.id}
            archetype={archetype}
            inBook={countByArchetype.get(archetype.id) ?? 0}
          />
        ))}
      </div>

      <p className="mt-8 rounded-2xl border border-line bg-surface p-5 text-sm text-ink-500">
        To walk a template as a customer would: open the{" "}
        <Link href="/quote" className="font-semibold text-accent-700 underline">
          quote funnel
        </Link>{" "}
        and answer with that house type and era, or open a matching home from{" "}
        <Link href="/ops/intel" className="font-semibold text-accent-700 underline">
          property intelligence
        </Link>{" "}
        and use its per-address page. Sample prices here run the live pricing
        engine on the stock floor plan's popular rooms.
      </p>
    </main>
  );
}

function ArchetypeCard({ archetype, inBook }: { archetype: HouseArchetype; inBook: number }) {
  // Sample price: the stock plan's popular rooms through the real engine.
  const rooms = archetype.typicalRooms
    .map((preset, i) => ({ preset, i }))
    .filter(({ preset }) => preset.popular)
    .map(({ preset, i }) => buildPresetRoom(archetype.id, preset, i));
  const permutation = archetype.permutations[0];
  const sampleSurvey: Survey | null =
    rooms.length > 0 && permutation
      ? {
          postcode: "SW16 1AA",
          addressLine: "Sample home",
          archetypeId: archetype.id,
          permutationId: permutation.id,
          property: {
            type: archetype.matches.types[0] ?? "semi-detached",
            era: archetype.matches.eras[0] ?? "1930-1950",
            bedrooms: rooms.filter((r) => r.type === "bedroom").length || 2,
            ownership: "owner",
          },
          rooms,
          outdoor: { location: permutation.outdoorLocation, photos: [] },
          electrics: { condition: "modern-spare-ways", photos: [] },
        }
      : null;
  const sample = sampleSurvey ? generateQuote(sampleSurvey) : null;

  return (
    <section className="rounded-3xl border border-line bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{archetype.name}</h2>
          <p className="text-sm text-ink-500">
            {archetype.eraLabel} · {archetype.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {inBook > 0 && (
            <Link
              href={`/ops/intel?archetypeId=${archetype.id}`}
              className="rounded-full bg-sage-100 px-3 py-1 text-xs font-semibold text-sage-700 hover:bg-sage-200"
            >
              {inBook.toLocaleString("en-GB")} in the book →
            </Link>
          )}
          {sample && (
            <span className="rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-700">
              sample {gbp(sample.totalGbp)} · {rooms.length} rooms
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Stock floor plan */}
        <div className="rounded-2xl bg-surface/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">
            Stock floor plan
          </p>
          <ul className="mt-2 space-y-1.5">
            {archetype.typicalRooms.map((room, i) => (
              <li key={`${room.name}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                <span className={room.popular ? "font-semibold" : "text-ink-500"}>
                  {room.name}
                  {room.popular && <span className="ml-1.5 text-xs text-accent-600">popular</span>}
                </span>
                <span className="text-xs text-ink-300">
                  {FLOOR_LABEL[room.floor] ?? room.floor} · {room.size}
                </span>
              </li>
            ))}
          </ul>
          {archetype.recognisers.length > 0 && (
            <p className="mt-3 text-xs text-ink-500">
              You know it when: {archetype.recognisers.join("; ").toLowerCase()}.
            </p>
          )}
        </div>

        {/* Install patterns */}
        <div className="space-y-3">
          {archetype.permutations.map((p) => (
            <div key={p.id} className="rounded-2xl border border-line p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-bold">{p.label}</p>
                <span className="shrink-0 text-xs font-semibold text-ink-500">
                  {p.adderGbp > 0 ? `+${gbp(p.adderGbp)}` : "no adder"} · up to {p.servesUpTo}{" "}
                  room{p.servesUpTo === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-500">{p.summary}</p>
              <p className="mt-1.5 text-xs text-ink-700">
                <span className="font-semibold">Pipe route:</span> {p.pipeRoute}
              </p>
              {p.checks.length > 0 && (
                <p className="mt-1.5 text-xs text-ink-300">
                  Pre-checks: {p.checks.join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
