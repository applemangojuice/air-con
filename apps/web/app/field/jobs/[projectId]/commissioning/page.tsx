import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Commissioning } from "@/components/field/commissioning";
import { JobNav } from "@/components/field/job-nav";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { currentDocument } from "@/lib/documents-server";
import { FieldError, commissioningHolds, loadFieldJob } from "@/lib/field-server";

/** Commissioning: results, targets, exceptions and the tech lead's signature. */

export const metadata: Metadata = { title: "Commissioning" };
export const dynamic = "force-dynamic";

export default async function CommissioningPage({ params }: { params: Promise<{ projectId: string }> }) {
  const staff = await requireStaff("install.work");
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId, { perm: "install.work" });
  if (!access || access.kind !== "staff") notFound();
  try {
    const [data, cert, holds] = await Promise.all([
      loadFieldJob(projectId, staff),
      currentDocument(projectId, "commissioning-certificate").catch(() => null),
      commissioningHolds(projectId, staff),
    ]);
    return (
      <>
        <JobNav projectId={projectId} active="commissioning" days={data.header.totalDays} />
        {/* INTEGRATION(F1): documents render at /d/[id]. */}
        <Commissioning data={data} holds={holds} {...(cert ? { certificateHref: `/d/${cert.id}` } : {})} />
      </>
    );
  } catch (err) {
    if (err instanceof FieldError && err.status === 404) notFound();
    throw err;
  }
}
