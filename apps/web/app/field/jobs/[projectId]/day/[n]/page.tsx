import { notFound } from "next/navigation";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";

/**
 * /field/jobs/<id>/day/<n>: the runsheet itself renders in ../layout.tsx and
 * reads the day from the URL. This page only checks access and the day number.
 */

export const dynamic = "force-dynamic";

export default async function FieldDayPage({ params }: { params: Promise<{ projectId: string; n: string }> }) {
  await requireStaff("install.work");
  const { projectId, n } = await params;
  const access = await requireProjectAccess(projectId, { perm: "install.work" });
  if (!access || access.kind !== "staff") notFound();
  const day = Number.parseInt(n, 10);
  if (!Number.isInteger(day) || day < 1 || day > 30 || String(day) !== n) notFound();
  return null;
}
