import Link from "next/link";
import type { Metadata } from "next";
import {
  ARCHETYPES,
  DEFAULT_ASSUMPTIONS,
  businessCase,
  getArchetype,
} from "@aircon/domain";
import { gbp } from "@/lib/format";
import { queryIntel, type IntelFilters, type IntelRow } from "@/lib/intel-server";
import { getServiceClient } from "@/lib/supabase-server";
import { recomputeAction, seedSampleBookAction, tagCampaignAction } from "./actions";

export const metadata: Metadata = {
  title: "Property intelligence · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const BAND_CLS: Record<string, string> = {
  hot: "bg-accent-100 text-accent-700",
  warm: "bg-amber-50 text-amber-700",
  standard: "bg-surface text-ink-500",
  low: "bg-surface text-ink-300",
  exclude: "bg-red-50 text-red-600",
};

type Search = Record<string, string | string[] | undefined>;

function readFilters(sp: Search): IntelFilters {
  const s = (k: string) => {
    const v = sp[k];
    return typeof v === "string" && v ? v : undefined;
  };
  return {
    outcode: s("outcode"),
    band: s("band"),
    archetypeId: s("archetypeId"),
    leadStatus: s("leadStatus"),
    planningRisk: s("planningRisk"),
    auditedOnly: sp.auditedOnly === "1",
  };
}

function filterQuery(f: IntelFilters): string {
  const q = new URLSearchParams();
  if (f.outcode) q.set("outcode", f.outcode);
  if (f.band) q.set("band", f.band);
  if (f.archetypeId) q.set("archetypeId", f.archetypeId);
  if (f.leadStatus) q.set("leadStatus", f.leadStatus);
  if (f.planningRisk) q.set("planningRisk", f.planningRisk);
  if (f.auditedOnly) q.set("auditedOnly", "1");
  return q.toString();
}

export default async function OpsIntelPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const filters = readFilters(sp);
  const demo = !getServiceClient();

  const [rows, everything] = await Promise.all([
    queryIntel(filters),
    queryIntel({}), // whole-book coverage stats
  ]);

  const audited = everything.filter((r) => r.audited).length;
  const withArchetype = everything.filter((r) => r.archetype_id).length;
  const hotWarm = everything.filter(
    (r) => r.priority_band === "hot" || r.priority_band === "warm",
  ).length;

  const byArchetype = new Map<string, number>();
  for (const r of everything) {
    const k = r.archetype_id ?? "unclassified";
    byArchetype.set(k, (byArchetype.get(k) ?? 0) + 1);
  }
  const archetypeDist = [...byArchetype.entries()].sort((a, b) => b[1] - a[1]);

  const outcodes = [...new Set(everything.map((r) => r.outcode))].sort();
  const bc = businessCase(rows.length);
  const qs = filterQuery(filters);
  const connectedButEmpty = !demo && everything.length === 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display">Property intelligence</h1>
          <p className="mt-1 text-sm text-ink-500">
            {demo
              ? "Demo dataset (SW16 + SW17). Connect Supabase and run the importer for the real book."
              : "The book: every property we understand, scored and ready to target."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <form action={recomputeAction}>
            <button className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-700 transition hover:bg-surface">
              Recompute scores
            </button>
          </form>
          <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
            ← All modules
          </Link>
        </div>
      </div>

      {/* Empty book: connected to Supabase but no properties imported yet.
          This is the "Properties: 0" case — explain it and offer a one-click
          sample seed so the view isn't a dead end. */}
      {connectedButEmpty && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="font-semibold text-amber-800">No properties in the book yet</p>
          <p className="mt-1 text-sm text-amber-700">
            The database is connected but the <code>properties</code> table is empty — that&apos;s
            why this reads 0. The SW16/SW17 sample homes you may have seen before only appear in
            demo mode (no database). Seed the sample book to explore the tools now, or run the EPC
            importer (see <code>docs/property-intelligence.md</code>) for the real thing.
          </p>
          <form action={seedSampleBookAction} className="mt-3">
            <button className="rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700">
              Seed sample book (~240 homes)
            </button>
          </form>
        </div>
      )}

      {/* Coverage */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Properties" value={everything.length.toLocaleString("en-GB")} />
        <Stat
          label="Classified"
          value={`${everything.length ? Math.round((withArchetype / everything.length) * 100) : 0}%`}
          hint={`${withArchetype.toLocaleString("en-GB")} matched to an install pattern`}
        />
        <Stat
          label="Audited"
          value={audited.toLocaleString("en-GB")}
          hint="Our proprietary layer"
        />
        <Stat
          label="Hot + warm"
          value={hotWarm.toLocaleString("en-GB")}
          hint="Mail-ready targets"
        />
      </div>

      {/* Archetype distribution */}
      <section className="mt-6 rounded-2xl border border-line p-5">
        <h2 className="font-bold">Install patterns across the book</h2>
        <div className="mt-3 space-y-2">
          {archetypeDist.map(([id, count]) => {
            const pct = everything.length ? Math.round((count / everything.length) * 100) : 0;
            return (
              <div key={id} className="flex items-center gap-3 text-sm">
                <span className="w-56 shrink-0 truncate">
                  {id === "unclassified" ? "Not yet classified" : (getArchetype(id)?.name ?? id)}
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface">
                  <div className="h-full rounded-full bg-sage-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right text-xs text-ink-500">
                  {count.toLocaleString("en-GB")} · {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Filters */}
      <section className="mt-6 rounded-2xl border border-line p-5">
        <h2 className="font-bold">Build a target list</h2>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <Select name="outcode" label="Area" value={filters.outcode} options={outcodes} />
          <Select
            name="band"
            label="Priority"
            value={filters.band}
            options={["hot", "warm", "standard", "low", "exclude"]}
          />
          <Select
            name="archetypeId"
            label="Install pattern"
            value={filters.archetypeId}
            options={ARCHETYPES.map((a) => a.id)}
            labels={Object.fromEntries(ARCHETYPES.map((a) => [a.id, a.name]))}
          />
          <Select
            name="leadStatus"
            label="Lead status"
            value={filters.leadStatus}
            options={["untouched", "mailed", "responded", "quoted", "customer", "excluded"]}
          />
          <Select
            name="planningRisk"
            label="Planning risk"
            value={filters.planningRisk}
            options={["none", "check", "high"]}
          />
          <label className="flex items-center gap-2 pb-2 font-medium text-ink-700">
            <input
              type="checkbox"
              name="auditedOnly"
              value="1"
              defaultChecked={filters.auditedOnly}
              className="h-4 w-4 accent-accent-600"
            />
            Audited only
          </label>
          <button className="rounded-full bg-accent-600 px-4 py-2 font-semibold text-white transition hover:bg-accent-700">
            Apply
          </button>
          <Link href="/ops/intel" className="pb-2 text-xs font-medium text-ink-500 hover:underline">
            Clear
          </Link>
        </form>
      </section>

      {/* Business case + campaign actions for the current list */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-accent-100 bg-accent-50/50 p-5">
          <h2 className="font-bold">
            Business case: mailing these {rows.length.toLocaleString("en-GB")} homes
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Fact k="Mail cost" v={gbp(bc.mailCostGbp)} />
            <Fact k="Expected quotes" v={String(bc.expectedQuotes)} />
            <Fact k="Expected installs" v={String(bc.expectedInstalls)} />
            <Fact k="Expected revenue" v={gbp(bc.expectedRevenueGbp)} />
            <Fact k="Gross profit" v={gbp(bc.expectedGrossProfitGbp)} />
            <Fact k="Cost per install" v={bc.costPerInstallGbp ? gbp(bc.costPerInstallGbp) : "n/a"} />
            <Fact k="Return on mail spend" v={`${bc.roi}×`} />
          </div>
          <p className="mt-3 text-xs text-ink-500">
            Assumes {gbp(DEFAULT_ASSUMPTIONS.mailCostGbp)}/letter, {DEFAULT_ASSUMPTIONS.responseRatePct}%
            response, {DEFAULT_ASSUMPTIONS.quoteToInstallPct}% quote → install,{" "}
            {gbp(DEFAULT_ASSUMPTIONS.avgOrderValueGbp)} order value,{" "}
            {DEFAULT_ASSUMPTIONS.grossMarginPct}% margin. Tune in{" "}
            <code>domain/intelligence.ts</code> as real numbers land.
          </p>
        </section>

        <section className="rounded-2xl border border-line p-5">
          <h2 className="font-bold">Run the mailing</h2>
          <a
            href={`/ops/intel/export${qs ? `?${qs}` : ""}`}
            className="mt-3 inline-block rounded-full bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-700"
          >
            Download mailing CSV ({rows.length.toLocaleString("en-GB")} homes)
          </a>
          <p className="mt-2 text-xs text-ink-500">
            One row per home with its personalised link (/a/…) for the mail merge.
          </p>
          <form action={tagCampaignAction} className="mt-4 flex flex-wrap items-center gap-2">
            {Object.entries({
              outcode: filters.outcode,
              band: filters.band,
              archetypeId: filters.archetypeId,
              leadStatus: filters.leadStatus,
              planningRisk: filters.planningRisk,
              auditedOnly: filters.auditedOnly ? "1" : undefined,
            }).map(([k, v]) =>
              v ? <input key={k} type="hidden" name={k} value={v} /> : null,
            )}
            <input
              name="campaign"
              required
              placeholder="Campaign name, e.g. SW16-hot-july"
              className="w-64 rounded-full border border-line bg-white px-4 py-2 text-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            />
            <button className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink-700 transition hover:bg-surface">
              Mark list as mailed
            </button>
          </form>
          {demo && (
            <p className="mt-2 text-xs text-ink-300">
              Demo mode: exports work, campaign tags don&apos;t persist.
            </p>
          )}
        </section>
      </div>

      {/* The list */}
      <section className="mt-6 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-xs font-semibold text-ink-500">
              <th className="px-4 py-3">Address</th>
              <th className="px-4 py-3">Pattern</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">EPC</th>
              <th className="px-4 py-3">m²</th>
              <th className="px-4 py-3">Loft</th>
              <th className="px-4 py-3">Risk</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Campaign</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.slice(0, 100).map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </tbody>
        </table>
        {rows.length > 100 && (
          <p className="px-4 py-3 text-xs text-ink-500">
            Showing the top 100 of {rows.length.toLocaleString("en-GB")} by priority. The CSV
            export carries the full list.
          </p>
        )}
        {rows.length === 0 && (
          <p className="px-4 py-6 text-sm text-ink-500">Nothing matches this filter.</p>
        )}
      </section>
    </main>
  );
}

function Row({ r }: { r: IntelRow }) {
  return (
    <tr className="hover:bg-surface/50">
      <td className="whitespace-nowrap px-4 py-2.5">
        <a
          href={`/a/${r.id}`}
          target="_blank"
          className="font-semibold text-accent-700 hover:underline"
        >
          {r.address_line}
        </a>
        <span className="block text-xs text-ink-300">{r.postcode}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-ink-700">
        {r.archetype_id ? (getArchetype(r.archetype_id)?.name ?? r.archetype_id) : "-"}
        {r.archetype_id && (
          <span className="block text-xs text-ink-300">{r.archetype_confidence}% sure</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${BAND_CLS[r.priority_band] ?? ""}`}
        >
          {r.priority_band} · {r.priority_score}
        </span>
      </td>
      <td className="px-4 py-2.5">{r.epc_rating ?? "-"}</td>
      <td className="px-4 py-2.5">{r.floor_area_m2 ?? "-"}</td>
      <td className="px-4 py-2.5">{r.has_loft_conversion ? "yes" : "-"}</td>
      <td className="px-4 py-2.5">{r.planning_risk === "none" ? "-" : r.planning_risk}</td>
      <td className="px-4 py-2.5">{r.lead_status}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-ink-500">{r.campaign ?? "-"}</td>
    </tr>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className="mt-1 text-2xl font-display">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <p className="flex justify-between gap-3">
      <span className="text-ink-500">{k}</span>
      <span className="font-semibold">{v}</span>
    </p>
  );
}

function Select({
  name,
  label,
  value,
  options,
  labels,
}: {
  name: string;
  label: string;
  value?: string;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-ink-500">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="rounded-full border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-accent-500"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );
}
