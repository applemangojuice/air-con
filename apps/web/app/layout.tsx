import type { Metadata, Viewport } from "next";
import { BRAND } from "@/lib/brand";
import { PrototypeNav } from "@/components/site/prototype-nav";
import "./globals.css";

export const metadata: Metadata = {
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
      <body className="min-h-dvh flex flex-col">
        {children}
        <PrototypeNav />
      </body>
    </html>
  );
}
