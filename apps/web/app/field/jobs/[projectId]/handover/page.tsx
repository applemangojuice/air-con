import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Handover } from "@/components/field/handover";
import { JobNav } from "@/components/field/job-nav";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { FieldError, handoverDraft, loadFieldJob } from "@/lib/field-server";

/** Handover with the customer: walkthrough, the pack, their sign-off. */

export const metadata: Metadata = { title: "Handover" };
export const dynamic = "force-dynamic";

export default async function HandoverPage({ params }: { params: Promise<{ projectId: string }> }) {
  const staff = await requireStaff("install.work");
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId, { perm: "install.work" });
  if (!access || access.kind !== "staff") notFound();
  try {
    const data = await loadFieldJob(projectId, staff);
    const draft = data.header.handoverStatus !== "pending" ? await handoverDraft(projectId, staff).catch(() => null) : null;
    return (
      <>
        <JobNav projectId={projectId} active="handover" days={data.header.totalDays} />
        <Handover data={data} pack={draft?.snapshot ?? null} missing={draft?.missing ?? []} />
      </>
    );
  } catch (err) {
    if (err instanceof FieldError && err.status === 404) notFound();
    throw err;
  }
}
