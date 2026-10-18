import type { Metadata } from "next";
import { can } from "@aircon/domain";
import { EmptyState, PageHeader } from "@/components/kit";
import { IssueCard } from "@/components/field/issue-card";
import { SyncBadge } from "@/components/field/sync-badge";
import { requireStaff } from "@/lib/auth/server";
import { listMyIssues } from "@/lib/field-server";

/** My open issues: on the jobs I'm on, and the ones I raised. Blocking ones first. */

export const metadata: Metadata = { title: "Issues" };
export const dynamic = "force-dynamic";

export default async function FieldIssuesPage() {
  const staff = await requireStaff();
  let issues: Awaited<ReturnType<typeof listMyIssues>> | null = null;
  try {
    issues = await listMyIssues(staff);
  } catch (err) {
    console.error("[field] issues failed:", err);
  }
  const sorted = (issues ?? []).sort((a, b) => Number(b.blocking) - Number(a.blocking) || b.raisedAt.localeCompare(a.raisedAt));
  const blocking = sorted.filter((i) => i.blocking).length;
  return (
    <>
      <SyncBadge />
      <PageHeader
        eyebrow="Issues"
        title="Open issues"
        subtitle={issues ? (sorted.length ? `${sorted.length} open${blocking ? `, ${blocking} holding a job` : ""}.` : "Nothing open on your jobs.") : undefined}
      />
      {!issues && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-900">
          We couldn&apos;t load the issues. Check your signal and try again.
        </div>
      )}
      {issues && sorted.length === 0 && (
        <EmptyState
          title="All clear"
          body="Issues raised on your jobs show here: missing kit, damage, questions for the office, snags. Raise one from a job's Actions button."
        />
      )}
      <ul className="space-y-4">
        {sorted.map((i) => (
          <li key={i.id}>
            <IssueCard issue={i} showJob canUpdate={can(staff, "install.work")} />
          </li>
        ))}
      </ul>
    </>
  );
}
