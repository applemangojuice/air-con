import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/site/logo";
import { QuoteWizard } from "@/components/quote/wizard";
import { getPublicSettings } from "@/lib/public-settings";

export const metadata: Metadata = {
  title: "Get your price",
  description:
    "Your price for heating and cooling your home in about two minutes, confirmed at a free home survey. No salesperson, no obligation.",
};

export default async function QuotePage({
  searchParams,
}: {
  searchParams: Promise<{ postcode?: string; intel?: string }>;
}) {
  const [{ postcode, intel }, settings] = await Promise.all([searchParams, getPublicSettings()]);

  return (
    <div className="min-h-dvh bg-cream">
      {/* Minimal header: keep the customer in the flow. */}
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4 sm:px-0">
          <Link href="/" aria-label="Dang, It's Hot home page">
            <Logo />
          </Link>
          <span className="text-xs font-medium text-ink-500">No obligation · No sales calls</span>
        </div>
      </header>
      <main>
        <QuoteWizard
          initialPostcode={postcode?.slice(0, 10)}
          initialIntel={intel && /^[a-z0-9-]{4,80}$/i.test(intel) ? intel : undefined}
          settings={settings}
        />
      </main>
    </div>
  );
}
