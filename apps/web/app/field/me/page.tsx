import type { Metadata } from "next";
import { QUALIFICATION_LABEL, REQUIREMENT_LABEL, ROLE_LABEL, meetsRequirement, qualificationStatus, type StepRequirement } from "@aircon/domain";
import { Card, PageHeader } from "@/components/kit";
import { SyncBadge } from "@/components/field/sync-badge";
import { fmtDate } from "@/components/field/format";
import { requireStaff } from "@/lib/auth/server";
import { londonToday } from "@/lib/project-service";

/** Me: who I'm signed in as, what I'm qualified to sign, when certificates run out, and sign out. */

export const metadata: Metadata = { title: "Me" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

export default async function FieldMePage() {
  const staff = await requireStaff();
  const today = londonToday();
  const reqs: StepRequirement[] = ["fgas", "electrical", "tech-lead"];
  return (
    <>
      <SyncBadge />
      <PageHeader eyebrow="Me" title={staff.name} subtitle={`${staff.roles.map((r) => ROLE_LABEL[r]).join(", ")}${staff.external ? " · subcontractor" : ""}`} />

      <Card className="mb-5">
        <h2 className="font-display text-xl text-ink-900">What you can sign off</h2>
        <ul className="mt-3 space-y-2">
          {reqs.map((r) => {
            const ok = meetsRequirement(staff, r, today);
            return (
              <li key={r} className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3">
                <span className="text-base text-ink-900">{REQUIREMENT_LABEL[r]}</span>
                <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${ok ? "bg-emerald-50 text-emerald-800" : "bg-white text-ink-700"}`}>{ok ? "Yes" : "No"}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-sm text-ink-500">Steps that need one of these stay locked for you on the runsheet. Ask the office if something here is wrong.</p>
      </Card>

      <Card className="mb-5">
        <h2 className="font-display text-xl text-ink-900">Qualifications</h2>
        {staff.qualifications.length === 0 ? (
          <p className="mt-2 text-base text-ink-700">None on file. The office adds certificates with their numbers and expiry dates.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {staff.qualifications.map((q, i) => {
              const status = qualificationStatus(q, today);
              const current = status === "current";
              const soon = q.expiresOn && current && Date.parse(q.expiresOn) - Date.parse(today) < 60 * DAY;
              return (
                <li key={`${q.kind}-${i}`} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink-900">{QUALIFICATION_LABEL[q.kind]}</p>
                    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${!current ? "bg-red-50 text-red-800" : soon ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
                      {status === "unverified" ? "Not checked yet" : !current ? "Expired" : soon ? "Expires soon" : "Current"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-700">
                    {q.reference}
                    {q.issuer ? ` · ${q.issuer}` : ""}
                    {q.expiresOn ? ` · expires ${fmtDate(q.expiresOn)}` : " · no expiry recorded"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mb-5">
        <h2 className="font-display text-xl text-ink-900">Account</h2>
        <p className="mt-2 text-base text-ink-700">{staff.email}</p>
        {staff.phone && <p className="text-base text-ink-700">{staff.phone}</p>}
        <form action="/auth/logout" method="post" className="mt-4">
          <input type="hidden" name="next" value="/login?signedOut=1" />
          <button type="submit" className="min-h-12 w-full rounded-full border border-line bg-white px-6 font-semibold text-ink-900 hover:bg-surface">
            Sign out
          </button>
        </form>
        <p className="mt-3 text-sm text-ink-500">Anything still waiting to sync stays on this phone and sends next time you sign in here.</p>
      </Card>
    </>
  );
}
