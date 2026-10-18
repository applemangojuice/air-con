import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/kit";
import { requireStaff } from "@/lib/auth/server";

/**
 * Placeholder "Today" for the field app. F6 replaces it with the real day:
 * assigned surveys and install days, each opening the job pack.
 */

export const metadata: Metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function FieldTodayPage() {
  const staff = await requireStaff();
  const first = staff.name.trim().split(/\s+/).filter((w) => w !== "DEMO")[0] || "there";
  return (
    <>
      <PageHeader eyebrow="Today" title={`Hi ${first}`} subtitle="Your surveys and install days." />
      <EmptyState
        title="Nothing here yet"
        body="Jobs assigned to you will show here, with everything you need for each visit."
      />
    </>
  );
}
