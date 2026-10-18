"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/server";
import {
  applyCsv,
  deleteRule,
  loadResearchedCatalogue,
  previewCsv,
  saveItem,
  saveRule,
  setItemActive,
  type CsvPreview,
  type SeedSummary,
} from "@/lib/catalogue-server";

/**
 * Catalogue writes (F3). Each action checks the live staff record for
 * `catalogue.edit` itself (server actions are reachable from any route),
 * validates on the server, and returns plain results the forms show.
 */

export type ActionResult<T = null> = { ok: true; value: T } | { ok: false; errors: string[] };
// Named, so no signature below carries braces (the route-guard test reads bodies by brace matching).
type SavedId = ActionResult<{ id: string }>;
type Imported = ActionResult<{ written: number; skipped: number; errors: string[] }>;

const failure = (err: unknown): { ok: false; errors: string[] } => {
  console.error("[catalogue] action failed:", err);
  return { ok: false, errors: ["Something went wrong saving that. Nothing was changed; please try again."] };
};

export async function saveCatalogueItemAction(input: unknown, mode: "create" | "update"): Promise<SavedId> {
  const staff = await requireStaff("catalogue.edit");
  try {
    const result = await saveItem(input, staff, mode === "create" ? "create" : "update");
    if (!result.ok) return result;
    revalidatePath("/ops/catalogue");
    revalidatePath(`/ops/catalogue/${result.value.id}`);
    return { ok: true, value: { id: result.value.id } };
  } catch (err) {
    return failure(err);
  }
}

export async function setCatalogueItemActiveAction(id: string, active: boolean): Promise<ActionResult> {
  const staff = await requireStaff("catalogue.edit");
  try {
    const result = await setItemActive(String(id), Boolean(active), staff);
    if (!result.ok) return result;
    revalidatePath("/ops/catalogue");
    revalidatePath(`/ops/catalogue/${id}`);
    return { ok: true, value: null };
  } catch (err) {
    return failure(err);
  }
}

export async function loadResearchedCatalogueAction(overwrite: boolean): Promise<ActionResult<SeedSummary>> {
  const staff = await requireStaff("catalogue.edit");
  try {
    const summary = await loadResearchedCatalogue(overwrite === true, staff);
    revalidatePath("/ops/catalogue");
    revalidatePath("/ops/catalogue/compatibility");
    return { ok: true, value: summary };
  } catch (err) {
    return failure(err);
  }
}

export async function previewCsvAction(csv: string): Promise<ActionResult<CsvPreview>> {
  await requireStaff("catalogue.edit");
  if (typeof csv !== "string") return { ok: false, errors: ["That wasn't a CSV file."] };
  try {
    return { ok: true, value: await previewCsv(csv) };
  } catch (err) {
    return failure(err);
  }
}

export async function applyCsvAction(csv: string): Promise<Imported> {
  const staff = await requireStaff("catalogue.edit");
  if (typeof csv !== "string") return { ok: false, errors: ["That wasn't a CSV file."] };
  try {
    const result = await applyCsv(csv, staff);
    if (result.ok) revalidatePath("/ops/catalogue");
    return result;
  } catch (err) {
    return failure(err);
  }
}

export async function saveRuleAction(input: unknown, mode: "create" | "update"): Promise<SavedId> {
  const staff = await requireStaff("catalogue.edit");
  try {
    const result = await saveRule(input, staff, mode === "create" ? "create" : "update");
    if (!result.ok) return result;
    revalidatePath("/ops/catalogue/compatibility");
    revalidatePath(`/ops/catalogue/compatibility/${result.value.id}`);
    return { ok: true, value: { id: result.value.id } };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  const staff = await requireStaff("catalogue.edit");
  try {
    const result = await deleteRule(String(id), staff);
    if (!result.ok) return result;
    revalidatePath("/ops/catalogue/compatibility");
    return { ok: true, value: null };
  } catch (err) {
    return failure(err);
  }
}
