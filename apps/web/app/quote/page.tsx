import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/site/logo";
import { QuoteWizard } from "@/components/quote/wizard";

export const metadata: Metadata = {
  title: "Get your fixed price",
};

export default async function QuotePage({
  searchParams,
}: {
  searchParams: Promise<{ postcode?: string }>;
}) {
  const { postcode } = await searchParams;

  return (
    <div className="min-h-dvh bg-white">
      {/* Minimal header: keep the customer in the flow. */}
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4 sm:px-0">
          <Link href="/" aria-label="Back to homepage">
            <Logo />
          </Link>
          <span className="text-xs font-medium text-ink-300">
            Fixed price · No obligation
          </span>
        </div>
      </header>
      <main>
        <QuoteWizard initialPostcode={postcode} />
      </main>
    </div>
  );
}
