import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CATALOGUE_KIND_LABEL,
  SPEC_FIELDS,
  can,
  daysBetweenDates,
  isConnectable,
  isStale,
  itemDisplayName,
  type CatalogueItem,
  type EquipmentSpecs,
} from "@aircon/domain";
import { Badge, Card, Money, PageHeader } from "@/components/kit";
import { ItemForm } from "@/components/ops/design/catalogue/item-form";
import { AvailabilityBadge, ConfidenceBadge, Row } from "@/components/ops/design/labels";
import { requireStaff } from "@/lib/auth/server";
import { loadCatalogue, withoutCosts } from "@/lib/catalogue-server";
import { fmtDate } from "@/lib/format";
import { londonToday } from "@/lib/project-service";

export const metadata: Metadata = { title: "Catalogue item · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

function specValue(key: keyof EquipmentSpecs, value: unknown, unit?: string): string {
  if (value === null || value === undefined || value === "") return "Not on record";
  if (key === "dimensionsMm" && typeof value === "object") {
    const d = value as { w: number; h: number; d: number };
    return `${d.w} × ${d.h} × ${d.d} mm`;
  }
  return unit && typeof value === "number" ? `${value} ${unit}` : String(value);
}

export default async function CatalogueItemPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("projects.view-all");
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const { items, rules } = await loadCatalogue();
  const found = items.find((i) => i.id === id);
  if (!found) notFound();
  const canEdit = can(staff, "catalogue.edit");
  const canSeeCosts = can(staff, "finance.view-margin");
  const item: CatalogueItem = canSeeCosts ? found : withoutCosts(found);
  const today = londonToday();
  const stale = isStale(item, today);
  const usedIn =
    item.kind === "outdoor"
      ? rules.filter((r) => item.model && r.outdoorModel.toLowerCase() === item.model.toLowerCase())
      : item.kind === "indoor"
        ? rules.filter((r) => isConnectable(r, item))
        : [];
  const pairOptions = items
    .filter((i) => (item.kind === "indoor" ? i.kind === "outdoor" : item.kind === "outdoor" ? i.kind === "indoor" : false))
    .map((i) => ({ id: i.id, label: itemDisplayName(i) }));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        back={{ href: "/ops/catalogue", label: "Catalogue" }}
        eyebrow={`${CATALOGUE_KIND_LABEL[item.kind]}${item.manufacturer ? ` · ${item.manufacturer}` : ""}`}
        title={item.label}
        subtitle={[item.model, item.series].filter(Boolean).join(" · ") || item.id}
      />
      <div className="-mt-3 mb-6 flex flex-wrap gap-2">
        <ConfidenceBadge item={item} today={today} />
        <AvailabilityBadge status={item.status} />
        {item.tier && <Badge>{item.tier === "premium" ? "Premium tier" : "Standard tier"}</Badge>}
        {!item.active && <Badge tone="neutral">Retired</Badge>}
      </div>

      <div className="mb-6 space-y-3">
        {stale && item.verifiedAt && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Last verified {fmtDate(item.verifiedAt)}, {daysBetweenDates(item.verifiedAt, today)} days ago. Check the datasheet again before quoting it.
          </p>
        )}
        {item.confidence === "provisional" && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Provisional: designs can use it, and customers see it labelled “to be confirmed” until someone checks it against the manufacturer's datasheet.
          </p>
        )}
        {item.status === "uncertain" && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Availability uncertain: confirm with the supplier before ordering.</p>
        )}
      </div>

      {usedIn.length > 0 && (
        <Card className="mb-6">
          <h2 className="font-display text-xl text-ink-900">Compatibility rules</h2>
          <ul className="mt-2 divide-y divide-line">
            {usedIn.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/ops/catalogue/compatibility/${encodeURIComponent(r.id)}`} className="font-semibold text-ink-900 underline-offset-2 hover:underline">
                  {item.kind === "outdoor" ? `Its rule: up to ${r.maxIndoorUnits} indoor units` : `Connects to ${r.outdoorModel}`}
                </Link>
                <Badge tone={r.confidence === "verified" ? "success" : "warn"} dot>
                  {r.confidence === "verified" ? "Verified rule" : "Provisional rule"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canEdit ? (
        <ItemForm item={item} today={today} pairOptions={pairOptions} />
      ) : (
        <div className="space-y-5">
          {item.customerBlurb && (
            <Card>
              <h2 className="font-display text-xl text-ink-900">For customers</h2>
              <p className="mt-2 text-ink-700">{item.customerBlurb}</p>
            </Card>
          )}
          {item.specs && (
            <Card>
              <h2 className="font-display text-xl text-ink-900">Specification</h2>
              <dl className="mt-2 divide-y divide-line">
                {SPEC_FIELDS.filter((f) => f.key in (item.specs ?? {})).map((f) => (
                  <Row key={f.key} label={f.label}>
                    <span className={item.specs?.[f.key] === null ? "text-ink-500" : ""}>{specValue(f.key, item.specs?.[f.key], f.unit)}</span>
                  </Row>
                ))}
              </dl>
            </Card>
          )}
          <Card>
            <dl className="divide-y divide-line">
              {canSeeCosts && (
                <Row label="Buy cost (ex VAT)">
                  <Money pence={item.costPence} />
                  {item.costSource?.supplier && <span className="text-ink-500"> · {item.costSource.supplier}</span>}
                  {item.costSource?.observedAt && <span className="text-ink-500"> · {fmtDate(item.costSource.observedAt)}</span>}
                </Row>
              )}
              <Row label="Unit">{item.unit ?? "each"}</Row>
              <Row label="Last verified">{item.verifiedAt ? fmtDate(item.verifiedAt) : "Not verified"}</Row>
              <Row label="Sources">
                {item.sources.length === 0 ? (
                  <span className="text-ink-500">None recorded</span>
                ) : (
                  <ul className="space-y-1">
                    {item.sources.map((s) => (
                      <li key={s.url}>
                        <a href={s.url} rel="noopener noreferrer" target="_blank" className="text-accent-700 underline-offset-2 hover:underline">
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
              {item.warranty && <Row label="Warranty">{item.warranty}</Row>}
              {item.notes && <Row label="Notes">{item.notes}</Row>}
            </dl>
          </Card>
        </div>
      )}
    </main>
  );
}
