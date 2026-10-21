/**
 * Shared class strings for the public site and the funnel (server-safe: no
 * "use client", so server pages can import them). The primary action is
 * accent-700: white text on it passes AA (accent-600 is about 4:1).
 */

export const primaryBtn =
  "inline-flex min-h-12 items-center justify-center rounded-sm bg-accent-700 px-6 py-3 font-semibold text-white transition hover:bg-accent-800 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryBtn =
  "inline-flex min-h-12 items-center justify-center rounded-sm border border-line bg-white px-5 py-3 font-semibold text-ink-900 transition hover:border-ink-500 hover:bg-surface disabled:opacity-50";

/** On the dark ink panels: a light button with ink text (AA either way). */
export const onDarkBtn =
  "inline-flex min-h-12 items-center justify-center rounded-sm bg-white px-6 py-3 font-semibold text-ink-900 transition hover:bg-accent-50";

export const textLink = "font-semibold text-accent-700 underline-offset-2 hover:underline";
