import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/kit/layout";
import { requireStaff } from "@/lib/auth/server";
import { mediaUrl, staffPhotoUrls } from "@/lib/ops-core-server";
import { londonToday } from "@/lib/project-service";
import * as staffRepo from "@/lib/repo/staff";
import { saveStaffAction } from "../actions";
import { StaffEditor } from "../staff-editor";

export const metadata: Metadata = { title: "Person · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireStaff("staff.edit");
  const { id } = await params;
  if (id === "new") {
    return (
      <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16 pt-6 sm:px-6">
        <PageHeader back={{ href: "/ops/staff", label: "Staff" }} title="Add a person" subtitle="They sign in with their email address: no passwords." />
        <StaffEditor action={saveStaffAction} today={londonToday()} />
      </main>
    );
  }
  if (!UUID_RE.test(id)) notFound();
  const stamped = await staffRepo.getStamped(id);
  if (!stamped) notFound();
  const person = stamped.member;
  const [photos, evidence] = await Promise.all([
    staffPhotoUrls([person]),
    Promise.all(person.qualifications.filter((q) => q.mediaId).map(async (q) => [q.mediaId!, await mediaUrl(q.mediaId!)] as const)),
  ]);
  const evidenceUrls = Object.fromEntries(evidence.filter((e): e is readonly [string, string] => Boolean(e[1])));

  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        back={{ href: "/ops/staff", label: "Staff" }}
        title={person.name}
        subtitle={person.demo ? "A DEMO account: it stops working when demo sign-in is turned off." : person.email}
      />
      <StaffEditor action={saveStaffAction} person={person} loadedAt={stamped.updatedAt} today={londonToday()} photoUrl={photos.get(person.id) ?? null} evidenceUrls={evidenceUrls} self={person.id === admin.id} />
    </main>
  );
}
