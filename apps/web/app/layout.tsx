import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s — ${BRAND.name}`,
  },
  description:
    "Get a fixed price for home air conditioning in minutes. Complete a guided photo survey of your home and book your installation online.",
};

export const viewport: Viewport = {
  themeColor: "#0a1c2e",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
