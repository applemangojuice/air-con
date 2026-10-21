import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { DEFAULT_SETTINGS } from "@aircon/domain";
import { toPublicSettings, type PublicSettings } from "@/components/site/claims";
import { SETTINGS_CACHE_TAG, getSettings } from "./settings-server";

/**
 * The public-safe subset of settings for marketing pages and the quote
 * funnel (see components/site/claims.ts for what's in it and why).
 *
 * Cached for a minute across requests and tagged "settings", so public pages
 * can stay static (ISR) and a settings change reaches them within a minute,
 * and at once when a save calls revalidateSettingsCaches().
 * Read failures fall back to the defaults, which make no warranty, VAT or
 * certification claims, so a database hiccup can only make the site quieter,
 * never boastful.
 */

// revalidateSettingsCaches() (called after every saveSettings()) clears this
// tag, so public pages pick up a change at once; the 60 s revalidate is only
// the backstop.
export const PUBLIC_SETTINGS_TAG = SETTINGS_CACHE_TAG;
export const PUBLIC_SETTINGS_REVALIDATE_SECONDS = 60;

const todayIso = () => new Date().toISOString().slice(0, 10);

const cachedPublicSettings = unstable_cache(
  async (): Promise<PublicSettings> => toPublicSettings(await getSettings(), todayIso()),
  ["public-settings-v1"],
  { revalidate: PUBLIC_SETTINGS_REVALIDATE_SECONDS, tags: [PUBLIC_SETTINGS_TAG] },
);

/**
 * After saveSettings(): drop every cached copy built from the old settings
 * (the tagged public subset, and every statically rendered page), so the
 * site, the funnel and the portal change at once. Server actions and route
 * handlers only.
 */
export function revalidateSettingsCaches(): void {
  revalidateTag(PUBLIC_SETTINGS_TAG);
  revalidatePath("/", "layout");
}

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
