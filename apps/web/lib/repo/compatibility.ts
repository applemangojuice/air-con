import type { CompatibilityRule } from "@aircon/domain";
import { db, jsonObject, must, nowIso, selectAllPages, type Row } from "./base";

/**
 * `catalogue_compatibility`: which indoor units an outdoor unit can drive.
 * A multi-split combination that isn't listed here (with its source) is
 * blocked at design time.
 */

const TABLE = "catalogue_compatibility";

export function fromRow(row: Row): CompatibilityRule {
  return { ...jsonObject<CompatibilityRule>(row.rule), id: String(row.id) };
}

export function toRow(rule: CompatibilityRule): Row {
  return { id: rule.id, outdoor_model: rule.outdoorModel, rule };
}

export async function get(id: string): Promise<CompatibilityRule | null> {
  if (!id) return null;
  const data = must(await db().from(TABLE).select("*").eq("id", id).maybeSingle(), "compatibility get");
  return data ? fromRow(data) : null;
}

export async function list(): Promise<CompatibilityRule[]> {
  // Page by page past Max Rows (1000), like the catalogue.
  const data = await selectAllPages<Row>(
    (from, to, count) =>
      db()
        .from(TABLE)
        .select("*", count ? { count: "exact" } : undefined)
        .order("outdoor_model", { ascending: true })
        .order("id")
        .range(from, to),
    "compatibility list",
  );
  return data.map(fromRow);
}

export async function forOutdoor(outdoorModel: string): Promise<CompatibilityRule[]> {
  const data = must(
    await db().from(TABLE).select("*").eq("outdoor_model", outdoorModel),
    "compatibility forOutdoor",
  );
  return (data ?? []).map(fromRow);
}

export async function upsert(rule: CompatibilityRule): Promise<CompatibilityRule> {
  const data = must(
    await db()
      .from(TABLE)
      .upsert({ ...toRow(rule), updated_at: nowIso() }, { onConflict: "id" })
      .select("*")
      .single(),
    "compatibility upsert",
  );
  return fromRow(data!);
}

export async function upsertMany(rules: CompatibilityRule[]): Promise<number> {
  const stamp = nowIso();
  for (let i = 0; i < rules.length; i += 200) {
    const chunk = rules.slice(i, i + 200).map((r) => ({ ...toRow(r), updated_at: stamp }));
    must(await db().from(TABLE).upsert(chunk, { onConflict: "id" }), "compatibility upsertMany");
  }
  return rules.length;
}

export async function remove(id: string): Promise<void> {
  must(await db().from(TABLE).delete().eq("id", id), "compatibility remove");
}
