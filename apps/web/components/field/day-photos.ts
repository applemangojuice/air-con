/**
 * The end-of-day photo picker's list, kept light on a phone at the end of a
 * long day (pure; tests/field.test.ts). A day can have a hundred photos, each
 * a 2048 px original: the picker draws the newest PICKER_PAGE of them as
 * small lazy thumbnails, with "Show more" for the rest, and a photo already
 * picked always stays in view. Opening the picker again reuses the URLs it
 * had (and so the browser's copies) while they're still well inside their
 * life, instead of fetching every photo again.
 */

/** Photos drawn at once; "Show more" adds the same again. */
export const PICKER_PAGE = 24;

/** URLs from an earlier load are reused this long (the server signs them for an hour or more). */
export const URL_REUSE_MS = 45 * 60_000;

export interface PickerPhoto {
  id: string;
  url: string | null;
  takenAt?: string;
}

export interface PickerGroup<P extends PickerPhoto = PickerPhoto> {
  photos: P[];
}

/**
 * The groups as drawn: only the newest `limit` photos across them, plus any
 * already chosen, in their groups' order; groups left empty are dropped.
 * `hidden` is how many more "Show more" would bring in.
 */
export function pickerShown<P extends PickerPhoto, G extends PickerGroup<P>>(groups: G[], limit: number, chosen: readonly string[]): { groups: G[]; hidden: number } {
  const all = groups.flatMap((g) => g.photos);
  const newest = [...all].sort((a, b) => (b.takenAt ?? "").localeCompare(a.takenAt ?? ""));
  const show = new Set([...newest.slice(0, Math.max(0, limit)).map((p) => p.id), ...chosen]);
  const shown = groups.map((g) => ({ ...g, photos: g.photos.filter((p) => show.has(p.id)) })).filter((g) => g.photos.length > 0);
  const drawn = shown.reduce((n, g) => n + g.photos.length, 0);
  return { groups: shown, hidden: all.length - drawn };
}

/** The URL each photo was given, and when: what reopening the picker can reuse. */
export type SignedUrls = Map<string, { url: string; at: number }>;

/**
 * A fresh load with the URLs an earlier one gave for the same photos kept,
 * while they're younger than URL_REUSE_MS: the same `src`, so the browser
 * shows what it already downloaded. Returns the groups to draw and the URL
 * record to keep for next time.
 */
export function reuseUrls<P extends PickerPhoto, G extends PickerGroup<P>>(groups: G[], earlier: SignedUrls | undefined, now: number): { groups: G[]; urls: SignedUrls } {
  const urls: SignedUrls = new Map();
  const out = groups.map((g) => ({
    ...g,
    photos: g.photos.map((p) => {
      const before = earlier?.get(p.id);
      if (before && now - before.at < URL_REUSE_MS) {
        urls.set(p.id, before);
        return { ...p, url: before.url };
      }
      if (p.url) urls.set(p.id, { url: p.url, at: now });
      return p;
    }),
  }));
  return { groups: out, urls };
}
