/**
 * The brand: Dang, It's Hot. Cooling technologies for the UK.
 * Everything brand-related reads from here; nothing else hard-codes it.
 * Collateral lives in public/brand/.
 */
export const BRAND = {
  name: "Dang, It's Hot",
  /** Split wordmark for the two-tone logo: ink "Dang," + hot "It's Hot". */
  nameLead: "Dang,",
  nameHot: "It's Hot",
  legalName: "Dang It's Hot Ltd",
  tagline: "Cooling technologies for the UK. Keeping London cool.",
  strap: "Keeping London cool",
  supportEmail: "hello@dang.ac",
  phoneDisplay: "0800 000 0000",
} as const;

/**
 * Canonical absolute URL of the deployed site, no trailing slash. The single
 * source for links in emails, printed collateral, sitemaps and exports —
 * replaces the (env ?? fallback).replace(...) idiom that had been copy-pasted
 * per file with drifting fallbacks.
 */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://dang.ac").replace(/\/$/, "");
}

/** The bare domain ("dang.ac") for display on printed pieces. */
export function appHost(): string {
  try {
    return new URL(appUrl()).host;
  } catch {
    return "dang.ac";
  }
}
