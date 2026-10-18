import type { CatalogueItem, CatalogueKind } from "@aircon/domain";
import { db, jsonObject, must, nowIso, type Row } from "./base";

/**
 * `catalogue_items`: equipment, materials, labour and services. Ids are
 * stable text keys (seed file, CSV imports), so re-imports upsert in place.
 * `cost_pence` null means unpriced, never free.
 */

const TABLE = "catalogue_items";

export function fromRow(row: Row): CatalogueItem {
  return { ...jsonObject<CatalogueItem>(row.item), id: String(row.id) };
}

export function toRow(item: CatalogueItem): Row {
  return {
    id: item.id,
    kind: item.kind,
    manufacturer: item.manufacturer ?? null,
    series: item.series ?? null,
    model: item.model ?? null,
    label: item.label,
    tier: item.tier ?? null,
    cost_pence: item.costPence,
    status: item.status,
    confidence: item.confidence,
    active: item.active,
    item,
  };
}

export async function get(id: string): Promise<CatalogueItem | null> {
  if (!id) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "catalogue get");
  return data ? fromRow(data) : null;
}

export async function list(opts: { kind?: CatalogueKind; activeOnly?: boolean } = {}): Promise<CatalogueItem[]> {
  let q = db().from(TABLE).select("*");
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.activeOnly) q = q.eq("active", true);
  const data = must(await q.order("kind", { ascending: true }).order("label", { ascending: true }), "catalogue list");
  return (data ?? []).map(fromRow);
}

/** What designs, costing and purchasing pick from. */
export function listActive(kind?: CatalogueKind): Promise<CatalogueItem[]> {
  return list({ kind, activeOnly: true });
}

export async function listByIds(ids: string[]): Promise<CatalogueItem[]> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return [];
  const data = must(await db().from(TABLE).select("*").in("id", wanted), "catalogue listByIds");
  return (data ?? []).map(fromRow);
}

export async function upsert(item: CatalogueItem): Promise<CatalogueItem> {
  const data = must(
    await db()
      .from(TABLE)
      .upsert({ ...toRow(item), updated_at: nowIso() }, { onConflict: "id" })
      .select("*")
      .single(),
    "catalogue upsert",
  );
  return fromRow(data!);
}

/** Bulk upsert (seed and CSV import), in chunks so a big file stays one request each. */
export async function upsertMany(items: CatalogueItem[]): Promise<number> {
  const stamp = nowIso();
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200).map((item) => ({ ...toRow(item), updated_at: stamp }));
    must(await db().from(TABLE).upsert(chunk, { onConflict: "id" }), "catalogue upsertMany");
  }
  return items.length;
}

/** Retire or restore an item. Items are never deleted: old designs reference them. */
export async function setActive(id: string, active: boolean): Promise<CatalogueItem | null> {
  const current = await get(id);
  if (!current) return null;
  return upsert({ ...current, active });
}
