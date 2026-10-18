import { unstable_cache } from "next/cache";
import { DEFAULT_SETTINGS } from "@aircon/domain";
import { toPublicSettings, type PublicSettings } from "@/components/site/claims";
import { getSettings } from "./settings-server";

/**
 * The public-safe subset of settings for marketing pages and the quote
 * funnel (see components/site/claims.ts for what's in it and why).
 *
 * Cached for a minute across requests and tagged "settings", so public pages
 * can stay static (ISR) and a settings change reaches them within a minute,
 * or at once if the settings editor calls revalidateTag("settings").
 * Read failures fall back to the defaults, which make no warranty, VAT or
 * certification claims, so a database hiccup can only make the site quieter,
 * never boastful.
 */

// INTEGRATION(F7): after saveSettings(), call revalidateTag(PUBLIC_SETTINGS_TAG)
// so public pages pick up the change immediately instead of within 60 s.
export const PUBLIC_SETTINGS_TAG = "settings";
export const PUBLIC_SETTINGS_REVALIDATE_SECONDS = 60;

const todayIso = () => new Date().toISOString().slice(0, 10);

const cachedPublicSettings = unstable_cache(
  async (): Promise<PublicSettings> => toPublicSettings(await getSettings(), todayIso()),
  ["public-settings-v1"],
  { revalidate: PUBLIC_SETTINGS_REVALIDATE_SECONDS, tags: [PUBLIC_SETTINGS_TAG] },
);

export async function getPublicSettings(): Promise<PublicSettings> {
  try {
    return await cachedPublicSettings();
  } catch (err) {
    console.error("[public-settings] read failed, using defaults:", err);
    return toPublicSettings(DEFAULT_SETTINGS, todayIso());
  }
}

/** The prototype nav: on outside production, and in production only when settings switch it on. */
export async function prototypeNavVisible(): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  return (await getPublicSettings()).showPrototypeNav;
}
