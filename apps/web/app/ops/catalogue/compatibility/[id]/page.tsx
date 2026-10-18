import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, isConnectable, itemDisplayName } from "@aircon/domain";
import { Badge, Card, PageHeader } from "@/components/kit";
import { RuleForm } from "@/components/ops/design/catalogue/rule-form";
import { Row } from "@/components/ops/design/labels";
import { requireStaff } from "@/lib/auth/server";
import { loadCatalogue } from "@/lib/catalogue-server";

export const metadata: Metadata = { title: "Compatibility rule · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function RulePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("projects.view-all");
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const { items, rules } = await loadCatalogue();
  const creating = id === "new";
  const rule = creating ? null : (rules.find((r) => r.id === id) ?? null);
  if (!creating && !rule) notFound();
  const canEdit = can(staff, "catalogue.edit");
  if (creating && !canEdit) notFound();
  const outdoorModels = items.filter((i) => i.kind === "outdoor" && i.model).map((i) => ({ model: i.model!, manufacturer: i.manufacturer }));
  const connectable = rule ? items.filter((i) => i.kind === "indoor" && i.active && isConnectable(rule, i)) : [];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        back={{ href: "/ops/catalogue/compatibility", label: "Compatibility rules" }}
        eyebrow={rule?.manufacturer ?? "Compatibility rule"}
        title={rule ? rule.outdoorModel : "Add a rule"}
        subtitle={rule ? `Up to ${rule.maxIndoorUnits} indoor units` : "From the manufacturer's combination table, with its source."}
      />
      {rule && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl text-ink-900">In the catalogue today</h2>
            <Badge tone={rule.confidence === "verified" ? "success" : "warn"} dot>
              {rule.confidence === "verified" ? "Verified" : "Provisional"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-500">Indoor units in the catalogue that this rule lets designs connect.</p>
          {connectable.length === 0 ? (
            <p className="mt-3 text-sm text-amber-800">None of the catalogue's indoor units match this rule's list yet.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {connectable.map((i) => (
                <li key={i.id}>
                  <Badge>{itemDisplayName(i)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {canEdit ? (
        <RuleForm rule={rule} outdoorModels={outdoorModels} />
      ) : (
        rule && (
          <Card>
            <dl className="divide-y divide-line">
              <Row label="Indoor models">{rule.connectableIndoorModels.join(", ") || "–"}</Row>
              <Row label="Indoor series">{rule.connectableIndoorSeries.join("; ") || "–"}</Row>
              <Row label="Connected capacity">
                {rule.minConnectedKw ?? "?"}–{rule.maxConnectedKw ?? "?"} kW
              </Row>
              <Row label="Pipe, total / per room">
                {rule.maxTotalPipeM ?? "?"} m / {rule.maxPipePerRoomM ?? "?"} m
              </Row>
              <Row label="Source">
                {rule.source ? (
                  <a href={rule.source.url} target="_blank" rel="noopener noreferrer" className="text-accent-700 underline-offset-2 hover:underline">
                    {rule.source.title ?? rule.source.url}
                  </a>
                ) : (
                  "None recorded"
                )}
              </Row>
              {rule.notes && <Row label="Notes">{rule.notes}</Row>}
            </dl>
          </Card>
        )
      )}
    </main>
  );
}
