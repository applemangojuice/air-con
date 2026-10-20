"use server";

import { revalidatePath } from "next/cache";
import type { PropertyIntel } from "@aircon/domain";
import {
  denormaliseIntel,
  queryIntel,
  seedSampleBook,
  tagCampaign,
  type IntelFilters,
} from "@/lib/intel-server";
import { requireStaff } from "@/lib/auth/server";
import { getServiceClient } from "@/lib/supabase-server";
import { demoModeAllowed } from "@/lib/auth/demo-guard";

/**
 * Server actions are reachable by id from any route, not just /ops, so each
 * one checks the staff session itself (contract §A7).
 */

function filtersFromForm(form: FormData): IntelFilters {
  const s = (k: string) => String(form.get(k) ?? "").trim() || undefined;
  return {
    outcode: s("outcode"),
    band: s("band"),
    archetypeId: s("archetypeId"),
    leadStatus: s("leadStatus"),
    planningRisk: s("planningRisk"),
    auditedOnly: form.get("auditedOnly") === "1",
  };
}

/** Stamp the current filtered set as a mailed campaign. */
export async function tagCampaignAction(form: FormData): Promise<void> {
  await requireStaff(["projects.edit", "projects.view-all"]);
  const campaign = String(form.get("campaign") ?? "").trim();
  if (!campaign) return;
  const rows = await queryIntel(filtersFromForm(form));
  const count = await tagCampaign(
    rows.map((r) => r.id),
    campaign,
    "mailed",
  );
  console.info(`campaign "${campaign}" tagged on ${count} properties`);
  revalidatePath("/ops/intel");
}

/**
 * Re-run classification + priority scoring across the whole book. Run this
 * after any import: the importer writes raw records and leaves the thinking
 * to the app, so archetypes and scores land here.
 */
export async function recomputeAction(): Promise<void> {
  await requireStaff(["projects.edit", "projects.view-all"]);
  const supabase = getServiceClient();
  if (!supabase) return; // demo data recomputes on the fly

  let from = 0;
  const page = 500;
  let updated = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("properties")
      .select("id, intel")
      .order("id")
      .range(from, from + page - 1);
    if (error) {
      console.error("recompute query failed:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const intel = row.intel as PropertyIntel;
      const { error: upErr } = await supabase
        .from("properties")
        .update(denormaliseIntel(intel))
        .eq("id", row.id);
      if (!upErr) updated++;
    }
    if (data.length < page) break;
    from += page;
  }
  console.info(`recomputed ${updated} properties`);
  revalidatePath("/ops/intel");
}

/**
 * One-click seed of the SW16/SW17 sample book into the real table, so the
 * intelligence view has something to explore before the EPC importer runs.
 */
export async function seedSampleBookAction(): Promise<void> {
  await requireStaff(["projects.edit", "projects.view-all"]);
  // ~240 made-up homes on real street names: never into a live property book (their pages and the mailing CSV would show them as public records).
  if (!(await demoModeAllowed())) {
    console.error("seed sample book refused: not a demo deployment");
    return;
  }
  const { inserted, error } = await seedSampleBook();
  if (error) console.error("seed sample book failed:", error);
  else console.info(`seeded ${inserted} sample properties`);
  revalidatePath("/ops/intel");
}
