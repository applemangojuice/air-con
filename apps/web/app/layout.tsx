import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { BRAND } from "@/lib/brand";
import { PrototypeNav } from "@/components/site/prototype-nav";
import { Analytics } from "@/components/site/analytics";
import "./globals.css";

/**
 * All three faces are self-hosted (Caprasimo + Figtree were previously a
 * render-blocking Google Fonts stylesheet): no third-party request in the
 * critical path, fonts served same-origin with immutable caching, and the
 * build never depends on fonts.googleapis.com being reachable.
 */
const brandFont = localFont({
  src: "./fonts/permanent-marker.woff2",
  variable: "--font-marker",
  display: "swap",
});

const displayFont = localFont({
  src: "./fonts/caprasimo.woff2",
  variable: "--font-caprasimo",
  display: "swap",
  weight: "400",
});

const sansFont = localFont({
  src: "./fonts/figtree-variable.woff2",
  variable: "--font-figtree",
  display: "swap",
  weight: "300 900",
});

const DESCRIPTION =
  "Get a fixed price for home air conditioning in minutes. Complete a guided photo survey of your home and book your installation online.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://dang.ac"),
  title: {
    default: `${BRAND.name} · ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: DESCRIPTION,
  // The share image comes from app/opengraph-image.tsx. Deliberately NO
  // og/twitter title or description here: Next only falls back to each
  // page's own <title>/description when the parent didn't set them, so
  // setting them at the root would stamp the homepage text on every page.
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  themeColor: "#201e1d",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body
        className={`${brandFont.variable} ${displayFont.variable} ${sansFont.variable} min-h-dvh flex flex-col`}
      >
        {/* Keyboard users skip the nav; visually hidden until focused. */}
        <a
          href="#main-content"
          className="no-print sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink-900 focus:px-5 focus:py-3 focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        {/* display:contents wrapper: an anchor target without touching layout. */}
        <div id="main-content" tabIndex={-1} className="contents">
          {children}
        </div>
        <PrototypeNav />
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
      </body>
    </html>
  );
}
