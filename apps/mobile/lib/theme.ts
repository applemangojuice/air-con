/**
 * Organic design system tokens (synced from the "Organic" Claude Design
 * project theme.json) — the same values as apps/web/app/globals.css.
 */
export const theme = {
  colors: {
    cream: "#f5ead8",
    surface: "#ebddc5",
    line: "#ddcdae",
    white: "#ffffff",

    ink950: "#161412",
    ink900: "#201e1d",
    ink700: "#4a4540",
    ink500: "#746c63",
    ink300: "#a89e90",

    accent50: "#faf1e6",
    accent100: "#f4dcc2",
    accent400: "#d68b56",
    accent500: "#c67139",
    accent600: "#aa5a29",
    accent700: "#884921",

    sage50: "#f1f3ea",
    sage100: "#e3e8d3",
    sage200: "#ccd5b2",
    sage500: "#7a8a5e",
    sage700: "#57633f",

    amber50: "#fdf5e3",
    amber700: "#8a5a12",
    red600: "#c03a2b",
  },
  radius: {
    md: 16,
    lg: 24,
    pill: 999,
  },
  space: (n: number) => Math.round(n * 4 * 1.1),
} as const;
