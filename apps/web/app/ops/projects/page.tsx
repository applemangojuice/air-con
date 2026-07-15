import Link from "next/link";
import type { Metadata } from "next";
import { STAGE_INFO, type ProjectStageId } from "@aircon/domain";
import { fmtDay, fmtDayTime } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Projects — ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const STAGE_CLS: Record<string, string> = {
  "floor-plan": "bg-accent-100 text-accent-700",
  "final-quote": "bg-accent-100 text-accent-700",
  "site-visit": "bg-amber-50 text-amber-700",
  delivery: "bg-sage-100 text-sage-700",
  installation: "bg-sage-100 text-sage-700",
};

export default async function OpsProjectsPage() {
  const supabase = getServiceClient();

  if (!supabase) {
    return (
      <Shell>
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-ink-500">
          <p className="font-semibold text-ink-900">Demo mode — no database connected</p>
          <p className="mt-2">
            Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> to see live
            projects here. The customer-side demo timeline is at <code>/p/demo</code>.
          </p>
        </div>
      </Shell>
    );
  }

  const { data: projects, error } = await supabase
    .from("projects")
    .select(
      "id, created_at, customer_name, postcode, current_stage, completed, site_visit_at, delivery_expected_on, install_on",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-red-600">Failed to load projects: {error.message}</p>
      </Shell>
    );
  }

  return (
    <Shell count={projects.length}>
      {projects.length === 0 ? (
        <p className="text-sm text-ink-500">
          No projects yet — they appear when a customer starts their installation plan from a
          saved quote.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-xs font-semibold text-ink-500">
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Postcode</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Site visit</th>
                <th className="px-4 py-3">Delivery</th>
                <th className="px-4 py-3">Install</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-surface/50">
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {new Date(p.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/ops/projects/${p.id}`}
                      className="font-semibold text-accent-700 hover:underline"
                    >
                      {p.customer_name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{p.postcode}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        p.completed
                          ? "bg-sage-100 text-sage-700"
                          : (STAGE_CLS[p.current_stage] ?? "bg-surface text-ink-500")
                      }`}
                    >
                      {p.completed
                        ? "complete"
                        : (STAGE_INFO[p.current_stage as ProjectStageId]?.label ?? p.current_stage)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {p.site_visit_at ? fmtDayTime(p.site_visit_at) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {p.delivery_expected_on ? fmtDay(p.delivery_expected_on) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                    {p.install_on ? fmtDay(p.install_on) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Projects</h1>
          <p className="mt-1 text-sm text-ink-500">
            {count !== undefined ? `${count} in flight` : "Quote → install pipelines"}
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← All modules
        </Link>
      </div>
      {children}
    </main>
  );
}
