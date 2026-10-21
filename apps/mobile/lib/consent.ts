/**
 * The quote consent wording, word for word as the web funnel shows it, with
 * the same version string, so a quote saved from the app records the words
 * its owner saw. Keep in step with apps/web/components/site/claims.ts
 * (CONSENT_VERSION, OPERATIONAL_CONSENT, MARKETING_CONSENT): the API stores
 * the version, and the wording behind it must be the one shown.
 */
export const CONSENT_VERSION = "quote-consent-v1";

export const OPERATIONAL_CONSENT = {
  label: "Save my quote and keep me posted about it",
  hint: "We'll email you about this quote and, if you go ahead, your survey and installation. Add your mobile and we'll text appointment reminders too. No sales calls and no marketing. Needed to save your quote.",
} as const;

export const MARKETING_CONSENT = {
  label: "Send me occasional news and offers by email",
  hint: "Seasonal tips, new areas and offers from us. Unsubscribe from any email, any time.",
} as const;

/** The photo types the survey-photos bucket takes (apps/web/lib/storage-buckets.ts SURVEY_PHOTO_TYPES). */
export const SURVEY_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
