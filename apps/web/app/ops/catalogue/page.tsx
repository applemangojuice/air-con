import type { Metadata } from "next";
import Link from "next/link";
import { CATALOGUE_KIND_LABEL, can, effectiveConfidence, itemDisplayName, type CatalogueItem } from "@aircon/domain";
import { RESEARCHED_AT, RESEARCH_CAVEATS } from "@aircon/domain/catalogue-data";
import { Badge, Card, EmptyState, LinkButton, Money, PageHeader, Stat } from "@/components/kit";
import { LoadResearch } from "@/components/ops/design/catalogue/load-research";
import { AvailabilityBadge, ConfidenceBadge, specLine } from "@/components/ops/design/labels";
import { requireStaff } from "@/lib/auth/server";
import { loadCatalogue } from "@/lib/catalogue-server";
import { fmtDate } from "@/lib/format";
import { londonToday } from "@/lib/project-service";

export const metadata: Metadata = { title: "Catalogue · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

const SELECT =
  "min-h-10 w-full rounded-full border border-line bg-white px-3 text-sm text-ink-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

export default async function CataloguePage({ searchParams }: { searchParams: Promise<Params> }) {
  const staff = await requireStaff("projects.view-all");
  const sp = await searchParams;
  const canEdit = can(staff, "catalogue.edit");
  const canSeeCosts = can(staff, "finance.view-margin");
  const today = londonToday();

  let items: CatalogueItem[] = [];
  let loadError = false;
  try {
    items = (await loadCatalogue()).items;
  } catch (err) {
    console.error("[catalogue] load failed:", err);
    loadError = true;
  }

  const f = {
    kind: one(sp.kind),
    manufacturer: one(sp.manufacturer),
    tier: one(sp.tier),
    confidence: one(sp.confidence),
    status: one(sp.status),
    active: one(sp.active) || "active",
    q: one(sp.q).toLowerCase(),
  };
  const manufacturers = [...new Set(items.map((i) => i.manufacturer).filter((m): m is string => !!m))].sort();
  const kindOrder = (k: CatalogueItem["kind"]) => ["indoor", "outdoor", "material", "tool", "labour", "service"].indexOf(k);
  items.sort(
    (a, b) =>
      kindOrder(a.kind) - kindOrder(b.kind) ||
      (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "") ||
      (a.specs?.coolingKw ?? 0) - (b.specs?.coolingKw ?? 0) ||
      a.label.localeCompare(b.label),
  );
  const shown = items.filter(
    (i) =>
      (!f.kind || i.kind === f.kind) &&
      (!f.manufacturer || i.manufacturer === f.manufacturer) &&
      (!f.tier || i.tier === f.tier) &&
      (!f.confidence || effectiveConfidence(i, today) === f.confidence) &&
      (!f.status || i.status === f.status) &&
      (f.active === "all" || (f.active === "retired" ? !i.active : i.active)) &&
      (!f.q || `${i.label} ${i.model ?? ""} ${i.series ?? ""} ${i.id}`.toLowerCase().includes(f.q)),
  );
  const filtered = Object.entries(f).some(([k, v]) => (k === "active" ? v !== "active" : v !== ""));

  const live = items.filter((i) => i.active);
  const stats = {
    equipment: live.filter((i) => i.kind === "indoor" || i.kind === "outdoor").length,
    verified: live.filter((i) => effectiveConfidence(i, today) === "verified").length,
    provisional: live.filter((i) => effectiveConfidence(i, today) === "provisional").length,
    stale: live.filter((i) => effectiveConfidence(i, today) === "stale").length,
    unpriced: live.filter((i) => i.costPence === null && i.kind !== "tool").length,
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Catalogue and rates"
        title="Catalogue"
        subtitle="What every design is built from and checked against."
        actions={
          <>
            <LinkButton href="/ops/catalogue/compatibility" variant="secondary">
              Compatibility rules
            </LinkButton>
            {canSeeCosts && items.length > 0 && (
              <a href="/ops/catalogue/export" className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold text-ink-700 hover:bg-surface hover:text-ink-900">
                Export CSV
              </a>
            )}
            {canEdit && (
              <>
                <LinkButton href="/ops/catalogue/import" variant="ghost">
                  Import CSV
                </LinkButton>
                <LinkButton href="/ops/catalogue/new">Add item</LinkButton>
              </>
            )}
          </>
        }
      />

      {loadError && (
        <p role="alert" className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          The catalogue couldn't be read just now. Refresh to try again.
        </p>
      )}

      {!loadError && items.length === 0 ? (
        <EmptyState
          title="The catalogue is empty"
          body={
            canEdit
              ? "Start from the researched catalogue: real Panasonic, Daikin and Mitsubishi model names with researched specs. Most of it is provisional and almost none of it is priced, and it says so on every item."
              : "An admin or technical lead loads the researched catalogue here. Designs can't be drafted until it has indoor and outdoor units."
          }
          action={canEdit ? <LoadResearch researchedAt={RESEARCHED_AT} caveats={RESEARCH_CAVEATS} empty /> : undefined}
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Equipment" value={stats.equipment} hint="Active indoor and outdoor units" />
            <Stat label="Verified" value={stats.verified} tone="success" hint="From a manufacturer source, within 90 days" />
            <Stat label="Provisional" value={stats.provisional} tone={stats.provisional ? "warn" : "neutral"} hint="Usable, labelled to customers" />
            <Stat label="Stale" value={stats.stale} tone={stats.stale ? "warn" : "neutral"} hint="Verified over 90 days ago" />
            <Stat label="Unpriced" value={stats.unpriced} tone={stats.unpriced ? "warn" : "neutral"} hint="No buy cost entered yet" />
          </div>

          <form method="get" className="mb-4 rounded-2xl border border-line bg-white p-4" aria-label="Filter the catalogue">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
              <label className="col-span-2 block text-xs font-semibold text-ink-700 md:col-span-4 lg:col-span-2">
                Search
                <input name="q" defaultValue={one(sp.q)} placeholder="Model, label or series" className={`${SELECT} mt-1`} />
              </label>
              <FilterSelect name="kind" label="Kind" value={f.kind} options={Object.entries(CATALOGUE_KIND_LABEL).map(([v, l]) => [v, l])} />
              <FilterSelect name="manufacturer" label="Brand" value={f.manufacturer} options={manufacturers.map((m) => [m, m])} />
              <FilterSelect name="tier" label="Tier" value={f.tier} options={[["standard", "Standard"], ["premium", "Premium (Quiet)"]]} />
              <FilterSelect name="confidence" label="Confidence" value={f.confidence} options={[["verified", "Verified"], ["provisional", "Provisional"], ["stale", "Stale"]]} />
              <FilterSelect name="status" label="Availability" value={f.status} options={[["available", "Available"], ["uncertain", "Uncertain"], ["discontinued", "Discontinued"]]} />
              <FilterSelect name="active" label="Showing" value={f.active} options={[["active", "In use"], ["retired", "Retired"], ["all", "All"]]} any={false} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="submit" className="inline-flex min-h-10 items-center rounded-full bg-ink-900 px-4 text-sm font-semibold text-white hover:bg-ink-700">
                Filter
              </button>
              {filtered && (
                <Link href="/ops/catalogue" className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold text-ink-700 hover:bg-surface">
                  Clear filters
                </Link>
              )}
              <p className="ml-auto text-sm text-ink-500" aria-live="polite">
                {shown.length} of {items.length} items
              </p>
            </div>
          </form>

          {shown.length === 0 ? (
            <EmptyState title="Nothing matches those filters" action={<LinkButton href="/ops/catalogue" variant="secondary">Clear filters</LinkButton>} />
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-2xl border border-line bg-white md:block">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Catalogue items</caption>
                  <thead className="border-b border-line bg-surface/60 text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-semibold">Item</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Kind</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Spec</th>
                      {canSeeCosts && <th scope="col" className="px-4 py-3 text-right font-semibold">Cost ex VAT</th>}
                      <th scope="col" className="px-4 py-3 font-semibold">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shown.map((i) => (
                      <tr key={i.id} className={`align-top ${i.active ? "" : "bg-surface/50"}`}>
                        <td className="max-w-[22rem] px-4 py-3">
                          <Link href={`/ops/catalogue/${encodeURIComponent(i.id)}`} className="font-semibold text-ink-900 underline-offset-2 hover:underline">
                            {i.label}
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-ink-500">{[i.manufacturer, i.model, i.unit].filter(Boolean).join(" · ") || i.id}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {i.status !== "available" && <AvailabilityBadge status={i.status} />}
                            {!i.active && <Badge>Retired</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-ink-700">
                          {CATALOGUE_KIND_LABEL[i.kind]}
                          {i.tier && <span className="block text-xs text-ink-500">{i.tier === "premium" ? "Premium" : "Standard"}</span>}
                        </td>
                        <td className="px-4 py-3 text-ink-700">{specLine(i) || <span className="text-ink-500">{i.category ?? "–"}</span>}</td>
                        {canSeeCosts && (
                          <td className="px-4 py-3 text-right">
                            <Money pence={i.costPence} />
                            {i.costSource?.observedAt && <span className="block text-xs text-ink-500">{fmtDate(i.costSource.observedAt)}</span>}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <ConfidenceBadge item={i} today={today} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="space-y-2 md:hidden">
                {shown.map((i) => (
                  <li key={i.id}>
                    <Link href={`/ops/catalogue/${encodeURIComponent(i.id)}`} className="block rounded-2xl border border-line bg-white p-4 hover:border-ink-300">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink-900">{itemDisplayName(i)}</p>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {CATALOGUE_KIND_LABEL[i.kind]}
                            {specLine(i) ? ` · ${specLine(i)}` : ""}
                          </p>
                        </div>
                        <ConfidenceBadge item={i} today={today} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        {canSeeCosts && <Money pence={i.costPence} />}
                        {i.status !== "available" && <AvailabilityBadge status={i.status} />}
                        {!i.active && <Badge>Retired</Badge>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="font-display text-xl text-ink-900">Labour rates</h2>
              <p className="mt-1.5 text-sm text-ink-500">
                Day rates for installers, the electrician and the technical lead live in settings, so every proposal costs labour the same way.
              </p>
              <div className="mt-4">
                <LinkButton href="/ops/settings" variant="secondary">
                  Open settings
                </LinkButton>
              </div>
            </Card>
            {canEdit && (
              <Card>
                <LoadResearch researchedAt={RESEARCHED_AT} caveats={RESEARCH_CAVEATS} />
              </Card>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function FilterSelect({ name, label, value, options, any = true }: { name: string; label: string; value: string; options: [string, string][]; any?: boolean }) {
  return (
    <label className="block text-xs font-semibold text-ink-700">
      {label}
      <select name={name} defaultValue={value} className={`${SELECT} mt-1`}>
        {any && <option value="">Any</option>}
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
