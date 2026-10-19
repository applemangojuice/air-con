import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { QUALIFICATION_LABEL, ROLE_LABEL, isVerifiedQualification, type StaffMember } from "@aircon/domain";
import { Badge } from "@/components/kit/badge";
import { LinkButton } from "@/components/kit/button";
import { EmptyState, PageHeader } from "@/components/kit/layout";
import { requireStaff } from "@/lib/auth/server";
import { fmtDate } from "@/lib/format";
import { staffPhotoUrls } from "@/lib/ops-core-server";
import { londonToday } from "@/lib/project-service";
import * as staffRepo from "@/lib/repo/staff";
import { getServiceClient } from "@/lib/supabase-server";
import { expiryState } from "./expiry";

export const metadata: Metadata = { title: "Staff · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

/** The team and subcontractors, with every qualification's expiry at a glance (admin only). */
export default async function StaffPage() {
  await requireStaff("staff.edit");
  if (!getServiceClient()) {
    return (
      <Shell>
        <EmptyState title="No database connected" body="The team lives in the database." />
      </Shell>
    );
  }
  let staff: StaffMember[] = [];
  let failed = false;
  try {
    staff = await staffRepo.list();
  } catch (err) {
    console.error("[staff] list failed:", err);
    failed = true;
  }
  const photos = await staffPhotoUrls(staff).catch(() => new Map<string, string>());
  const today = londonToday();
  const sorted = [...staff].sort((a, b) => Number(b.active) - Number(a.active) || Number(a.external) - Number(b.external) || a.name.localeCompare(b.name));
  const attention = staff.filter((s) => s.active && s.qualifications.some((q) => ["expired", "soon"].includes(expiryState(q.expiresOn, today))));

  return (
    <Shell>
      {failed ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          The team couldn&apos;t load. Reload in a moment.
        </p>
      ) : staff.length === 0 ? (
        <EmptyState title="Nobody here yet" body="Add the team and any subcontractors, with their certificates." action={<LinkButton href="/ops/staff/new">Add a person</LinkButton>} />
      ) : (
        <>
          {attention.length > 0 && (
            <p role="status" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {attention.length === 1 ? `${attention[0]!.name} has` : `${attention.length} people have`} a qualification that has expired or expires within 60 days.
            </p>
          )}
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
            {sorted.map((s) => (
              <li key={s.id}>
                <Link href={`/ops/staff/${s.id}`} className="flex flex-col gap-3 px-4 py-4 transition hover:bg-surface/50 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {photos.get(s.id) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photos.get(s.id)} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface font-display text-lg text-ink-700">
                        {s.name.slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900">
                        {s.name}
                        {!s.active && <span className="ml-2 text-sm font-normal text-ink-500">(inactive)</span>}
                      </p>
                      <p className="truncate text-sm text-ink-500">{s.email}</p>
                      <p className="mt-1 flex flex-wrap gap-1">
                        {s.roles.map((r) => (
                          <Badge key={r} tone="neutral">
                            {ROLE_LABEL[r]}
                          </Badge>
                        ))}
                        {s.external && <Badge tone="info">Subcontractor</Badge>}
                        {s.demo && <Badge tone="warn">DEMO</Badge>}
                      </p>
                    </div>
                  </div>
                  <ul className="flex flex-wrap gap-1.5 sm:max-w-[50%] sm:justify-end">
                    {s.qualifications.length === 0 ? (
                      <li className="text-xs text-ink-500">No qualifications recorded</li>
                    ) : (
                      s.qualifications.map((q, i) => {
                        const st = expiryState(q.expiresOn, today);
                        const unchecked = st !== "expired" && !isVerifiedQualification(q);
                        return (
                          <li key={i}>
                            <Badge tone={st === "expired" ? "danger" : st === "soon" || unchecked ? "warn" : "success"}>
                              {QUALIFICATION_LABEL[q.kind]}
                              {unchecked ? " · not verified" : q.expiresOn ? ` · ${st === "expired" ? "expired" : "to"} ${fmtDate(q.expiresOn)}` : ""}
                            </Badge>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full min-w-0 max-w-5xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader title="Staff" subtitle="Who's on the team, what they can do, and the certificates that let them do it." actions={<LinkButton href="/ops/staff/new">Add a person</LinkButton>} />
      {children}
    </main>
  );
}
