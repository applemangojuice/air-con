import Link from "next/link";
import type { Metadata } from "next";
import type { PropertyIntel } from "@aircon/domain";
import { requireStaff } from "@/lib/auth/server";
import { countProperties } from "@/lib/intel-server";
import { SPACE, bytesPerHome, fieldStats, getPath, slimIntel, UNUSED_EPC_KEYS } from "@/lib/intel-fields";
import { formatBytes } from "@/lib/epc-scan";
import { getServiceClient } from "@/lib/supabase-server";
import { SlimTools } from "./slim-tools";

export const metadata: Metadata = { title: "Property data preview" };
export const dynamic = "force-dynamic";

/** Homes sampled from four places across the book (by id), so the figures aren't one street's. */
const SAMPLE_PER_SLICE = 250;

export default async function IntelDataPage() {
  await requireStaff("settings.edit");
  const supabase = getServiceClient();
  if (!supabase) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-sm">No database is connected, so there&apos;s no book to look at.</p>
      </main>
    );
  }

  const total = (await countProperties()) ?? 0;
  const { count: notes } = await supabase
    .from("property_assessments")
    .select("id", { count: "exact", head: true })
    .eq("source", "epc-import");

  const starts = total <= SAMPLE_PER_SLICE * 4 ? [0] : [0, 1, 2, 3].map((q) => Math.floor((total * q) / 4));
  const sample: { id: string; intel: PropertyIntel }[] = [];
  for (const start of starts) {
    const { data } = await supabase
      .from("properties")
      .select("id, intel")
      .order("id")
      .range(start, start + (starts.length === 1 ? SAMPLE_PER_SLICE * 4 : SAMPLE_PER_SLICE) - 1);
    sample.push(...((data ?? []) as { id: string; intel: PropertyIntel }[]));
  }
  const intels = sample.map((s) => s.intel);
  const stats = fieldStats(intels);
  const nowPerHome = bytesPerHome(intels);
  const slimPerHome = bytesPerHome(intels.map((i) => slimIntel(i).intel));
  const needSlimming = intels.filter((i) => slimIntel(i).changed).length;
  const notesBytes = (notes ?? 0) * SPACE.historyNote;
  const nowTotal = total * nowPerHome + notesBytes;
  const afterTotal = total * slimPerHome;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const n = (v: number) => v.toLocaleString("en-GB");

  const show = (intel: PropertyIntel, path: string) => {
    const v = getPath(intel, path);
    return v === undefined || v === null || v === "" ? "–" : String(v);
  };
  const preview = sample.filter((_, i) => i % Math.max(1, Math.floor(sample.length / 20)) === 0).slice(0, 20);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Link href="/ops/intel" className="text-sm font-medium text-accent-700 hover:underline">
        ← Property intelligence
      </Link>
      <h1 className="mt-3 text-2xl font-display">Property data preview</h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-600">
        What the book holds for each home, how much space it takes, and what the app uses it for. Figures come from{" "}
        {n(sample.length)} homes sampled across the book; space is an estimate from measurements of this table (the
        exact figure is one SQL line below).
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Homes" value={n(total)} />
        <Stat label="Space now (estimate)" value={formatBytes(nowTotal)} hint={`about ${n(Math.round(nowPerHome))} bytes a home`} />
        <Stat label="History notes" value={n(notes ?? 0)} hint={`about ${formatBytes(notesBytes)}`} />
        <Stat
          label="After slimming"
          value={formatBytes(afterTotal)}
          hint={nowTotal > 0 ? `saves about ${formatBytes(nowTotal - afterTotal)} (${pct(1 - afterTotal / nowTotal)})` : undefined}
        />
      </div>

      <section className="mt-8">
        <h2 className="font-bold">What&apos;s stored for each home</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface text-left text-ink-500">
              <tr>
                <th className="px-4 py-2 font-medium">Detail</th>
                <th className="py-2 font-medium">Used for</th>
                <th className="py-2 text-right font-medium">Filled in</th>
                <th className="py-2 text-right font-medium">Space (whole book)</th>
                <th className="px-4 py-2 font-medium">Most common values</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((f) => (
                <tr key={f.path} className={`border-t border-line/60 align-top ${f.usedFor ? "" : "bg-amber-50/60"}`}>
                  <td className="px-4 py-2 font-medium">{f.label}</td>
                  <td className="py-2 pr-4 text-ink-600">{f.usedFor ?? <span className="font-semibold text-amber-800">Not used</span>}</td>
                  <td className="py-2 text-right tabular-nums">{pct(f.fillRate)}</td>
                  <td className="py-2 text-right tabular-nums">{formatBytes(f.bytesPerHome * total)}</td>
                  <td className="px-4 py-2 text-ink-600">
                    {f.top.length === 0
                      ? "–"
                      : f.top.map((t) => (
                          <span key={t.value} className="mr-3 inline-block">
                            {t.value.length > 40 ? `${t.value.slice(0, 40)}…` : t.value}{" "}
                            <span className="text-ink-300">×{n(t.count)}</span>
                          </span>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-sm text-ink-500">
          Shaded rows: nothing in the app reads them ({UNUSED_EPC_KEYS.length} details). New imports no longer store them,
          and they&apos;re still in your download if they&apos;re ever wanted.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-bold">A sample of homes</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface text-left text-ink-500">
              <tr>
                {["Address", "Postcode", "Type", "Built form", "Age band", "Floor m²", "Rooms", "Rating", "Glazing", "Certificate", "Unused details"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium first:pl-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map(({ id, intel }) => (
                <tr key={id} className="border-t border-line/60">
                  <td className="py-1.5 pl-4 pr-3">
                    <Link href={`/a/${encodeURIComponent(id)}`} className="hover:underline">
                      {show(intel, "address.line1")}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">{show(intel, "address.postcode")}</td>
                  <td className="px-3 py-1.5">{show(intel, "epc.propertyType")}</td>
                  <td className="px-3 py-1.5">{show(intel, "epc.builtForm")}</td>
                  <td className="px-3 py-1.5">{show(intel, "epc.constructionAgeBand").replace(/^England and Wales:\s*/i, "")}</td>
                  <td className="px-3 py-1.5 tabular-nums">{show(intel, "epc.totalFloorAreaM2")}</td>
                  <td className="px-3 py-1.5 tabular-nums">{show(intel, "epc.habitableRooms")}</td>
                  <td className="px-3 py-1.5">{show(intel, "epc.currentRating")}</td>
                  <td className="px-3 py-1.5">{show(intel, "epc.glazingDescription")}</td>
                  <td className="px-3 py-1.5">{show(intel, "epc.lodgedAt")}</td>
                  <td className="px-3 py-1.5 text-ink-500">
                    {UNUSED_EPC_KEYS.filter((k) => getPath(intel, `epc.${k}`) !== undefined).length || "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SlimTools total={total} needSlimming={Math.round((needSlimming / Math.max(1, intels.length)) * total)} notes={notes ?? 0} />
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className="mt-1 text-2xl font-display">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
