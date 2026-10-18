import type { Metadata } from "next";
import Link from "next/link";
import { can, type CompatibilityRule } from "@aircon/domain";
import { Badge, EmptyState, LinkButton, PageHeader } from "@/components/kit";
import { requireStaff } from "@/lib/auth/server";
import { loadCatalogue } from "@/lib/catalogue-server";

export const metadata: Metadata = { title: "Compatibility rules · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const range = (min: number | null, max: number | null, unit: string) =>
  min === null && max === null ? "Not on record" : `${min === null ? "?" : min}–${max === null ? "?" : max} ${unit}`;

export default async function CompatibilityPage() {
  const staff = await requireStaff("projects.view-all");
  const canEdit = can(staff, "catalogue.edit");
  const { items, rules } = await loadCatalogue();
  const outdoorByModel = new Map(items.filter((i) => i.kind === "outdoor" && i.model).map((i) => [i.model!.toLowerCase(), i]));
  const provisional = rules.filter((r) => r.confidence !== "verified").length;
  const sorted = [...rules].sort((a, b) => (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "") || a.outdoorModel.localeCompare(b.outdoorModel));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        back={{ href: "/ops/catalogue", label: "Catalogue" }}
        eyebrow="Catalogue"
        title="Compatibility rules"
        subtitle="Which indoor units each multi-split outdoor unit can drive. A multi-split without a rule here can't be designed."
        actions={canEdit ? <LinkButton href="/ops/catalogue/compatibility/new">Add a rule</LinkButton> : undefined}
      />

      {provisional > 0 && (
        <div role="note" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            {provisional} of {rules.length} rules are provisional.
          </p>
          <p className="mt-1">
            Their indoor-unit lists were partly worked out from capacity ranges and retailer bundles, not copied from the manufacturer's combination table. A design on one of
            them can only be approved by a technical lead who ticks that they've checked the official table.
          </p>
        </div>
      )}

      {rules.length === 0 ? (
        <EmptyState
          title="No compatibility rules yet"
          body="Without rules, every design uses single splits. Load the researched catalogue for the researched rules, or add one from a manufacturer's combination table."
          action={canEdit ? <LinkButton href="/ops/catalogue">Go to the catalogue</LinkButton> : undefined}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {sorted.map((r) => (
            <RuleCard key={r.id} rule={r} hasOutdoor={outdoorByModel.has(r.outdoorModel.toLowerCase())} outdoorId={outdoorByModel.get(r.outdoorModel.toLowerCase())?.id} />
          ))}
        </ul>
      )}
    </main>
  );
}

function RuleCard({ rule, hasOutdoor, outdoorId }: { rule: CompatibilityRule; hasOutdoor: boolean; outdoorId?: string }) {
  return (
    <li className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{rule.manufacturer ?? "Outdoor unit"}</p>
          <Link href={`/ops/catalogue/compatibility/${encodeURIComponent(rule.id)}`} className="font-display text-xl text-ink-900 underline-offset-2 hover:underline">
            {rule.outdoorModel}
          </Link>
        </div>
        <Badge tone={rule.confidence === "verified" ? "success" : "warn"} dot>
          {rule.confidence === "verified" ? "Verified" : "Provisional"}
        </Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-ink-500">Indoor units</dt>
          <dd className="font-medium text-ink-900">Up to {rule.maxIndoorUnits}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Connected capacity</dt>
          <dd className="font-medium text-ink-900">{range(rule.minConnectedKw, rule.maxConnectedKw, "kW")}</dd>
        </div>
        <div>
          <dt className="text-ink-500">Pipe, total / per room</dt>
          <dd className="font-medium text-ink-900">
            {rule.maxTotalPipeM ?? "?"} m / {rule.maxPipePerRoomM ?? "?"} m
          </dd>
        </div>
        <div>
          <dt className="text-ink-500">Listed indoor models</dt>
          <dd className="font-medium text-ink-900">{rule.connectableIndoorModels.length || "By series"}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {rule.source ? (
          <a href={rule.source.url} target="_blank" rel="noopener noreferrer" className="text-accent-700 underline-offset-2 hover:underline">
            Source{rule.source.title ? `: ${rule.source.title}` : ""}
          </a>
        ) : (
          <span className="text-red-700">No source recorded</span>
        )}
        {hasOutdoor && outdoorId ? (
          <Link href={`/ops/catalogue/${encodeURIComponent(outdoorId)}`} className="text-ink-700 underline-offset-2 hover:underline">
            Catalogue item
          </Link>
        ) : (
          <span className="text-amber-800">No catalogue record for this outdoor unit</span>
        )}
      </div>
    </li>
  );
}
