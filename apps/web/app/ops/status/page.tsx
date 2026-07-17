import Link from "next/link";
import type { Metadata } from "next";
import { healthReport, type HealthReport } from "@/lib/health";

export const metadata: Metadata = {
  title: "System status · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * The "is the database actually working?" page. One glance says whether
 * Supabase is connected, reachable, and fully migrated — and if not, exactly
 * which table or bucket is missing and what it breaks for customers.
 */
export default async function OpsStatusPage() {
  const report = await healthReport();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">System status</h1>
          <p className="mt-1 text-sm text-ink-500">
            Database health, storage and configuration at a glance.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← All modules
        </Link>
      </div>

      <Banner report={report} />

      {report.configured && (
        <>
          <Section title="Database tables">
            <p className="mb-3 text-sm text-ink-500">
              Every table the app reads and writes. A missing table means that
              feature silently fails — run the migration named in{" "}
              <code>supabase/migrations/</code> to create it.
            </p>
            <div className="divide-y divide-line rounded-2xl border border-line">
              {report.tables.map((t) => (
                <div key={t.table} className="flex items-start gap-3 px-4 py-3">
                  <Dot ok={t.ok} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {t.label}{" "}
                      <code className="text-xs font-normal text-ink-300">{t.table}</code>
                    </p>
                    {t.ok ? (
                      <p className="text-sm text-ink-500">
                        {t.count?.toLocaleString("en-GB")} row{t.count === 1 ? "" : "s"}
                        {t.count === 0 && (
                          <span className="text-ink-300"> · empty, nothing captured yet</span>
                        )}
                      </p>
                    ) : (
                      <>
                        <p className="text-sm text-red-600">{t.error}</p>
                        <p className="mt-0.5 text-xs text-ink-500">{t.impact}</p>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Storage buckets">
            <p className="mb-3 text-sm text-ink-500">
              Survey photos and videos upload straight to these private buckets.
              A missing bucket is what causes the &ldquo;invalid path&rdquo;
              upload error on the funnel.
            </p>
            <div className="divide-y divide-line rounded-2xl border border-line">
              {report.buckets.map((b) => (
                <div key={b.bucket} className="flex items-start gap-3 px-4 py-3">
                  <Dot ok={b.ok} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {b.label}{" "}
                      <code className="text-xs font-normal text-ink-300">{b.bucket}</code>
                    </p>
                    {!b.ok && <p className="text-sm text-red-600">{b.error}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      <Section title="Configuration">
        <div className="divide-y divide-line rounded-2xl border border-line">
          {report.env.map((e) => (
            <div key={e.key} className="flex items-start gap-3 px-4 py-3">
              <Dot ok={e.set} warn={!e.set && !e.required} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {e.label}{" "}
                  <code className="text-xs font-normal text-ink-300">{e.key}</code>
                  {!e.required && (
                    <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase text-ink-300">
                      optional
                    </span>
                  )}
                </p>
                <p className="text-sm text-ink-500">
                  {e.set ? "Set." : e.required ? "Missing — required." : "Not set."} {e.note}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <section className="mt-8 rounded-2xl border border-line bg-surface p-6 text-sm text-ink-500">
        <p className="font-semibold text-ink-900">Fixing a red row</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            In Supabase → SQL editor, run every file in{" "}
            <code>supabase/migrations/</code> in order (0001 → 0007). Re-running
            is safe; they use <code>if not exists</code>.
          </li>
          <li>
            Confirm <code>SUPABASE_URL</code> and{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code> in Vercel match this exact
            project, then redeploy.
          </li>
          <li>
            Properties empty? Open{" "}
            <Link href="/ops/intel" className="text-accent-700 hover:underline">
              Property intelligence
            </Link>{" "}
            and seed the sample book, or run the EPC importer.
          </li>
          <li>Refresh this page — the row should go green.</li>
        </ol>
      </section>
    </main>
  );
}

function Banner({ report }: { report: HealthReport }) {
  if (!report.configured) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="font-semibold text-amber-800">Demo mode — no database connected</p>
        <p className="mt-1 text-sm text-amber-700">
          <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> aren&apos;t set, so
          the site works but saves nothing. Set them in Vercel to turn persistence on.
        </p>
      </div>
    );
  }
  if (!report.reachable) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <p className="font-semibold text-red-700">Can&apos;t reach the database</p>
        <p className="mt-1 text-sm text-red-600">
          Supabase is configured but every query failed:{" "}
          <code>{report.connectionError}</code>. Usually the URL or service-role key is wrong, or
          points at a different project.
        </p>
      </div>
    );
  }
  if (!report.healthy) {
    const missing = report.tables.filter((t) => !t.ok).length + report.buckets.filter((b) => !b.ok).length;
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <p className="font-semibold text-red-700">
          Connected, but {missing} thing{missing === 1 ? "" : "s"} {missing === 1 ? "is" : "are"} missing
        </p>
        <p className="mt-1 text-sm text-red-600">
          This is why data isn&apos;t being captured. Run the outstanding migrations below.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-sage-200 bg-sage-50 p-5">
      <p className="font-semibold text-sage-800">All systems go</p>
      <p className="mt-1 text-sm text-sage-700">
        Database connected, every table and bucket present. Data is being captured.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-display">{title}</h2>
      {children}
    </section>
  );
}

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const color = ok ? "bg-sage-500" : warn ? "bg-amber-400" : "bg-red-500";
  return <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${color}`} aria-hidden />;
}
