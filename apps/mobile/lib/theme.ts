/**
 * Dang, It's Hot brand tokens, the same values as apps/web/app/globals.css:
 * paper ground, ink blue-black, hot orange accent, splash blue second
 * accent (kept in the historical sage-* slots).
 */
export const theme = {
  colors: {
    cream: "#f8f5ef",
    surface: "#efeade",
    line: "#ddd5c4",
    white: "#ffffff",

    ink950: "#14171e",
    ink900: "#1d212b",
    ink700: "#454b58",
    ink500: "#6e7482",
    ink300: "#a3a8b4",

    accent50: "#fef3ea",
    accent100: "#fcdfc5",
    accent400: "#f78e45",
    accent500: "#f2711b",
    accent600: "#d55a0a",
    accent700: "#a84508",

    sage50: "#eef3f8",
    sage100: "#dce7f0",
    sage200: "#bcd2e2",
    sage500: "#47698a",
    sage700: "#345373",

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
