import { bomLineFlags, type CatalogueItem, type DesignBomLine } from "@aircon/domain";
import { Badge } from "@/components/kit";

/**
 * The bill of materials for one option, grouped. Flags say what isn't
 * settled yet: provisional data, no buy price (only to people who see
 * costs), not in the catalogue, uncertain availability. No prices here:
 * costing is the proposal's job.
 */

const GROUPS: { key: DesignBomLine["category"]; label: string }[] = [
  { key: "equipment", label: "Equipment" },
  { key: "materials", label: "Materials" },
  { key: "consumables", label: "Consumables" },
];

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function BomTable({ bom, catalogue, canSeeCosts }: { bom: DesignBomLine[]; catalogue: CatalogueItem[]; canSeeCosts: boolean }) {
  if (bom.length === 0) return <p className="text-sm text-ink-500">Nothing to list yet: choose the units first.</p>;
  const flagged = bom.map((line) => ({ line, flags: bomLineFlags(line, catalogue) }));
  const unpriced = flagged.filter((f) => f.flags.unpriced).length;
  const missing = flagged.filter((f) => f.flags.notInCatalogue).length;
  return (
    <div>
      {(missing > 0 || (canSeeCosts && unpriced > 0)) && (
        <p className="mb-3 text-sm text-ink-500">
          {missing > 0 && `${missing} line${missing === 1 ? " isn't" : "s aren't"} in the catalogue yet. `}
          {canSeeCosts && unpriced > 0 && `${unpriced} line${unpriced === 1 ? " has" : "s have"} no buy price, so the proposal's cost build-up will show ${unpriced === 1 ? "it" : "them"} as unpriced.`}
        </p>
      )}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {GROUPS.map((g) => {
          const rows = flagged.filter((f) => f.line.category === g.key);
          if (rows.length === 0) return null;
          return (
            <table key={g.key} className="w-full table-fixed text-left text-sm">
              <caption className="border-b border-line bg-surface/60 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">{g.label}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ line, flags }) => (
                  <tr key={`${line.catalogueItemId ?? line.sku}`} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-900">{line.label}</p>
                      {line.note && <p className="mt-0.5 text-xs text-ink-500">{line.note}</p>}
                      {(flags.notInCatalogue || flags.provisional || flags.uncertain || (canSeeCosts && flags.unpriced && !flags.notInCatalogue)) && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {flags.notInCatalogue && <Badge tone="danger">Not in catalogue</Badge>}
                          {flags.provisional && <Badge tone="warn">Provisional</Badge>}
                          {flags.uncertain && <Badge tone="warn">Availability uncertain</Badge>}
                          {canSeeCosts && flags.unpriced && !flags.notInCatalogue && <Badge>Not priced</Badge>}
                        </div>
                      )}
                    </td>
                    <td className="w-28 px-4 py-3 text-right tabular-nums text-ink-900 sm:w-40">
                      {qty(line.qty)} <span className="text-ink-500">{line.unit ?? "each"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })}
      </div>
    </div>
  );
}
