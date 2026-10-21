import { cache } from "react";
import { DEFAULT_SETTINGS, mergeSettings, sameJson, type PilotSettings } from "@aircon/domain";
import { audit, type AuditActorInput } from "./audit";
import * as settingsRepo from "./repo/settings";
import { getServiceClient } from "./supabase-server";

/**
 * The business's settings (contract §D1/§F): the `pilot` row of the
 * settings table merged over the domain defaults, so a setting added in code
 * needs no data migration and a half-saved document can't break a page.
 *
 * Read once per request (React `cache`); both getters below share the read.
 */
const readSettings = cache(async (): Promise<{ ok: true; settings: PilotSettings } | { ok: false; error: unknown }> => {
  if (!getServiceClient()) return { ok: true, settings: mergeSettings(DEFAULT_SETTINGS) };
  try {
    return { ok: true, settings: mergeSettings(await settingsRepo.getValue(settingsRepo.PILOT_SETTINGS_KEY)) };
  } catch (error) {
    return { ok: false, error };
  }
});

/**
 * For reading: a failed read falls back to the defaults, which are
 * deliberately conservative (no VAT claims, no warranty years, terms
 * unreviewed), so pages always render. Never use it to write: see
 * getSettingsStrict.
 */
export async function getSettings(): Promise<PilotSettings> {
  const read = await readSettings();
  if (read.ok) return read.settings;
  console.error("[settings] read failed, using defaults:", read.error);
  return mergeSettings(DEFAULT_SETTINGS);
}

/** What an action answers when settings can't be read for a write. */
export const SETTINGS_UNAVAILABLE = "We couldn't read the business settings just now, so nothing was saved. Try again in a moment.";

/** Settings couldn't be read, so nothing built from them was saved. */
export class SettingsUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(SETTINGS_UNAVAILABLE);
    this.name = "SettingsUnavailableError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * For writing: the same settings, but a failed read throws
 * (SettingsUnavailableError) instead of returning the defaults. Anything
 * that freezes business facts into a record (a proposal, the contract, an
 * invoice or receipt, a certificate, a booked date) or saves settings back
 * uses this, so a database blip fails the action and it's tried again,
 * rather than storing the placeholder company, VAT and deposit for good.
 */
export async function getSettingsStrict(): Promise<PilotSettings> {
  const read = await readSettings();
  if (read.ok) return read.settings;
  console.error("[settings] read failed; refusing to write on the defaults:", read.error);
  throw new SettingsUnavailableError(read.error);
}

/** getSettingsStrict, or null when they can't be read: the caller refuses with SETTINGS_UNAVAILABLE (HTTP 503). */
export async function settingsForWrite(): Promise<PilotSettings | null> {
  try {
    return await getSettingsStrict();
  } catch {
    return null;
  }
}

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
    (k) => !sameJson(merged[k], before[k]),
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
