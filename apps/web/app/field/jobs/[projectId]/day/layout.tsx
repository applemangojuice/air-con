import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Runsheet } from "@/components/field/runsheet";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { FieldError, loadFieldJob } from "@/lib/field-server";

/**
 * The day runsheet lives in this layout, not in day/[n]/page.tsx: all three
 * days load together and the day tabs only change the URL, so a background
 * refresh after a sync re-renders the runsheet in place instead of
 * remounting it (which would close the step you're on and drop what you're
 * typing).
 */

export const metadata: Metadata = { title: "Runsheet" };
export const dynamic = "force-dynamic";

export default async function FieldDayLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const staff = await requireStaff("install.work");
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId, { perm: "install.work" });
  if (!access || access.kind !== "staff") notFound();
  let data;
  try {
    data = await loadFieldJob(projectId, staff);
  } catch (err) {
    if (err instanceof FieldError && err.status === 404) notFound();
    throw err;
  }
  return (
    <>
      <Runsheet data={data} />
      {children}
    </>
  );
}
