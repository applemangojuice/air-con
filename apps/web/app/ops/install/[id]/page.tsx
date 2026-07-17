import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { demoInstallJobs } from "@aircon/domain";
import { RunsheetPlayer } from "@/components/ops/runsheet-player";
import { fmtDay } from "@/lib/format";

export const metadata: Metadata = {
  title: "Engineer runsheet · admin",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * One job's runsheet: the exact screen an engineer works through on site.
 * Playable end to end with simulated captures; readings can be typed to
 * exercise the exception flow.
 */
export default async function RunsheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = demoInstallJobs(new Date().toISOString()).find((j) => j.id === id);
  if (!job) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">{job.customer}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {job.postcode} · {fmtDay(job.scheduledOn)} · engineer {job.engineer}. Nothing
            proceeds without evidence; nothing is remembered, everything is captured.
          </p>
        </div>
        <Link href="/ops/install" className="shrink-0 text-sm font-medium text-accent-700 hover:underline">
          ← All jobs
        </Link>
      </div>
      <RunsheetPlayer initialJob={job} />
    </main>
  );
}
