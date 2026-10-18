import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Runsheet } from "@/components/field/runsheet";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { FieldError, loadFieldJob } from "@/lib/field-server";

/** The day runsheet (all three days load; the URL picks which one shows first). */

export const metadata: Metadata = { title: "Runsheet" };
export const dynamic = "force-dynamic";

export default async function FieldDayPage({ params }: { params: Promise<{ projectId: string; n: string }> }) {
  const staff = await requireStaff("install.work");
  const { projectId, n } = await params;
  const access = await requireProjectAccess(projectId, { perm: "install.work" });
  if (!access || access.kind !== "staff") notFound();
  const day = Number.parseInt(n, 10);
  if (!Number.isInteger(day) || day < 1 || day > 30) notFound();
  try {
    const data = await loadFieldJob(projectId, staff);
    return <Runsheet data={data} initialDay={day} />;
  } catch (err) {
    if (err instanceof FieldError && err.status === 404) notFound();
    throw err;
  }
}
