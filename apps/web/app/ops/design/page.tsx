import Link from "next/link";
import type { Metadata } from "next";
import { DesignStudio } from "@/components/ops/design-studio";

export const metadata: Metadata = {
  title: "Design studio · admin",
  robots: { index: false },
};

/**
 * The engineering assistant: rules engine first, equipment selection second.
 * One button turns a property into a buildable spec with traffic lights.
 */
export default function DesignPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Design studio</h1>
          <p className="mt-1 text-sm text-ink-500">
            Eight engineering rules, then the kit picks itself. Green builds
            without a human; amber gets a glance; red tells you what data is
            missing. Engineers validate exceptions, not every job.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← Console
        </Link>
      </div>
      <DesignStudio />
    </main>
  );
}
