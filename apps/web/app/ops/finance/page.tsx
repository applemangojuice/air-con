import Link from "next/link";
import type { Metadata } from "next";
import { FinancePlanner } from "@/components/ops/finance-planner";

export const metadata: Metadata = {
  title: "Business case · admin",
  robots: { index: false },
};

/**
 * The business case & P&L planning tool. Two jobs: managing costs (every
 * line is a dial) and raising investment (the cash trough is the ask).
 * All maths lives in @aircon/domain/finance.ts, pure and tested.
 */
export default function FinancePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display">Business case & P&L</h1>
          <p className="mt-1 text-sm text-ink-500">
            Turn assumptions into a monthly P&L, a breakeven month and a funding ask. The
            mailing numbers link straight to the{" "}
            <Link href="/ops/intel" className="font-semibold text-accent-700 underline">
              property intelligence
            </Link>{" "}
            channel.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← Console
        </Link>
      </div>
      <FinancePlanner />
    </main>
  );
}
