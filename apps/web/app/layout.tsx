import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import { PrototypeNav } from "@/components/site/prototype-nav";
import { Analytics } from "@/components/site/analytics";
import "./globals.css";

/**
 * The brand lettering (wordmark, hero moments) is self-hosted so the logo
 * can never fall back to a system font. Everything else keeps Caprasimo /
 * Figtree from Google Fonts.
 */
const brandFont = localFont({
  src: "./fonts/permanent-marker.woff2",
  variable: "--font-marker",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://dang.ac"),
  title: {
    default: `${BRAND.name} · ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description:
    "Get a fixed price for home air conditioning in minutes. Complete a guided photo survey of your home and book your installation online.",
};

export const viewport: Viewport = {
  themeColor: "#201e1d",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${brandFont.variable} min-h-dvh flex flex-col`}>
        {children}
        <PrototypeNav />
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
      </body>
    </html>
  );
}
