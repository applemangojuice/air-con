import { cache } from "react";
import { DEFAULT_SETTINGS, mergeSettings, type PilotSettings } from "@aircon/domain";
import { audit, type AuditActorInput } from "./audit";
import * as settingsRepo from "./repo/settings";
import { getServiceClient } from "./supabase-server";

/**
 * The business's settings (contract §D1/§F): the `pilot` row of the
 * settings table merged over the domain defaults, so a setting added in code
 * needs no data migration and a half-saved document can't break a page.
 *
 * Read once per request (React `cache`). Demo mode and read failures fall
 * back to the defaults, which are deliberately conservative (no VAT claims,
 * no warranty years, terms unreviewed), so public pages always render.
 */

export const getSettings = cache(async (): Promise<PilotSettings> => {
  if (!getServiceClient()) return mergeSettings(DEFAULT_SETTINGS);
  try {
    return mergeSettings(await settingsRepo.getValue(settingsRepo.PILOT_SETTINGS_KEY));
  } catch (err) {
    console.error("[settings] read failed, using defaults:", err);
    return mergeSettings(DEFAULT_SETTINGS);
  }
});

/** The cache tag on everything built from settings (lib/public-settings.ts caches the public subset under it). */
export const SETTINGS_CACHE_TAG = "settings";

/**
 * Save the whole settings document (merged first, so junk can't be stored)
 * and audit it with the top-level sections that changed. Callers check
 * `settings.edit` before calling, and then call `revalidateSettingsCaches()`
 * (lib/public-settings.ts; Next-only, so not from here) so the public site,
 * the funnel and the portal change at once, not when their cache runs out.
 */
export async function saveSettings(next: PilotSettings, actor: AuditActorInput): Promise<PilotSettings> {
  const merged = mergeSettings(next);
  const before = mergeSettings(await settingsRepo.getValue(settingsRepo.PILOT_SETTINGS_KEY));
  const name = actor && "name" in actor ? actor.name : undefined;
  await settingsRepo.setValue(settingsRepo.PILOT_SETTINGS_KEY, merged, name);
  const changed = (Object.keys(merged) as (keyof PilotSettings)[]).filter(
    (k) => JSON.stringify(merged[k]) !== JSON.stringify(before[k]),
  );
  await audit({
    actor,
    action: "settings.save",
    entity: "settings",
    entityId: settingsRepo.PILOT_SETTINGS_KEY,
    detail: { changed },
  });
  return merged;
}
