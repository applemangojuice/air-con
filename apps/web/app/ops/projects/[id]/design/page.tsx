import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { manufacturersFor } from "@aircon/domain";
import { EmptyState, LinkButton, PageHeader, StatusChip } from "@/components/kit";
import { DesignStudio } from "@/components/ops/design/design-studio";
import { DraftDesignButton, RelockButton } from "@/components/ops/design/design-buttons";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { loadDesignPage, viewerFor } from "@/lib/design-server";
import { fmtDate, fmtDayTime } from "@/lib/format";
import { londonToday } from "@/lib/project-service";
import { isUuid } from "@/lib/repo/base";

export const metadata: Metadata = { title: "Design · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const access = await requireProjectAccess(id);
  if (!access || access.kind !== "staff") notFound();

  const today = londonToday();
  const viewer = viewerFor(staff, today);
  const data = await loadDesignPage(id, viewer);
  if (!data) notFound();
  const { project, survey, design } = data;
  const editable = viewer.canEdit && project.proposal.status !== "accepted";
  const brands = [...new Set([...manufacturersFor("standard", data.catalogue), ...manufacturersFor("premium", data.catalogue)])].sort();
  const hasIndoor = data.catalogue.some((i) => i.kind === "indoor" && i.active);
  const surveySubmitted = project.survey.status === "submitted" && survey !== null;
  const surveyChanged = Boolean(design && survey && design.surveyRecordId && design.surveyRecordId !== survey.id);
  const proposalHref = `/ops/projects/${id}/proposal`;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        back={{ href: `/ops/projects/${id}`, label: project.customer.name || "Project" }}
        eyebrow={[project.pilot?.label, "Design"].filter(Boolean).join(" · ")}
        title={design ? `Design v${design.version}` : "Design"}
        subtitle={[project.customer.addressLine, project.customer.postcode].filter(Boolean).join(", ")}
        actions={
          <>
            {design && <StatusChip status={design.status} />}
            <LinkButton href={`/field/survey/${id}`} variant="secondary">
              Survey
            </LinkButton>
            {design?.status === "approved" && (
              <LinkButton href={proposalHref} variant="secondary">
                Proposal
              </LinkButton>
            )}
          </>
        }
      />

      {!surveySubmitted ? (
        <EmptyState
          title="The survey isn't in yet"
          body={
            project.survey.status === "booked" && project.survey.scheduledFor
              ? `The home survey is booked for ${fmtDayTime(project.survey.scheduledFor)}. The design starts from what's measured there: room sizes, pipe runs, the outdoor spot and the photos.`
              : project.survey.status === "in-progress"
                ? "The surveyor is on it. Once they submit, the design can be drafted from what they measured."
                : "The design starts from the measured home survey. Book the survey first."
          }
          action={
            <LinkButton href={`/field/survey/${id}`} variant="secondary">
              Open the survey
            </LinkButton>
          }
        />
      ) : !design ? (
        <EmptyState
          title={hasIndoor ? "Ready to design" : "The catalogue needs loading first"}
          body={
            hasIndoor
              ? `${survey!.data.rooms.filter((r) => r.include).length} rooms measured on ${fmtDate(survey!.submittedAt ?? survey!.startedAt ?? project.survey.submittedAt ?? today)}. The engine drafts a Standard and a Quiet option from the catalogue; you check every room, change what needs changing (with a reason), and send it for sign-off.`
              : "Designs pick units from the catalogue, and it has no indoor units yet. Load the researched catalogue, then come back."
          }
          action={
            !hasIndoor ? (
              <LinkButton href="/ops/catalogue">Open the catalogue</LinkButton>
            ) : editable ? (
              <DraftDesignButton projectId={id} brands={brands} />
            ) : (
              <p className="text-sm text-ink-500">Someone with design access drafts it.</p>
            )
          }
        />
      ) : (
        <>
          <div className="mb-6 space-y-3">
            {project.proposal.status === "accepted" && (
              <p role="note" className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-ink-700">
                The customer has accepted the proposal, so this design is fixed. Any change now goes through a variation.
              </p>
            )}
            {design.status === "approved" && ["issued", "changes-requested"].includes(project.proposal.status) && (
              <p role="note" className="rounded-2xl border border-sage-200 bg-sage-50 px-4 py-3 text-sm text-sage-900">
                Proposal v{project.proposal.version ?? 1} was issued from this design. Changing the design means approving it again and issuing a new proposal version.
              </p>
            )}
            {surveyChanged && (
              <div role="note" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="min-w-0 flex-1">The survey was updated after this design was drafted (survey v{survey!.version}). Re-draft to start from the new measurements.</p>
                {editable && <DraftDesignButton projectId={id} brands={[]} label="Re-draft from the survey" variant="secondary" confirm="This replaces the current choices with a fresh draft (the old version is kept in the history)." />}
              </div>
            )}
            {data.surveyInProgress && (
              <p role="note" className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-ink-700">
                A re-survey is in progress. This design uses the last submitted survey until the new one is submitted.
              </p>
            )}
            {data.unlockedLayout.length > 0 && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="min-w-0 flex-1">
                  {data.unlockedLayout.length} layout photo{data.unlockedLayout.length === 1 ? " isn't" : "s aren't"} locked yet, so {data.unlockedLayout.length === 1 ? "its" : "their"} drawing could still be edited.
                </p>
                {viewer.canApprove && <RelockButton projectId={id} />}
              </div>
            )}
            {!data.hasIntel && design.status !== "approved" && (
              <p className="text-sm text-ink-500">
                No property record for this address, so listing, conservation area and Article 4 come from the survey only.{" "}
                <Link href="/ops/intel" className="font-semibold text-accent-700 underline-offset-2 hover:underline">
                  Property intelligence
                </Link>
              </p>
            )}
          </div>
          <DesignStudio
            key={design.id}
            projectId={id}
            design={design}
            catalogue={data.catalogue}
            compatibility={data.compatibility}
            media={data.media}
            viewer={viewer}
            editable={editable}
            catalogueChanged={data.catalogueChanged}
            history={data.history}
            today={today}
            proposalHref={proposalHref}
          />
          {editable && !surveyChanged && (
            <details className="mt-10 rounded-2xl border border-line bg-white px-5 py-4">
              <summary className="cursor-pointer text-sm font-semibold text-ink-900">Start again from the survey</summary>
              <p className="mb-4 mt-2 text-sm text-ink-500">
                A fresh draft from the measured survey and today's catalogue, optionally on one brand. The current version stays in the history.
              </p>
              <DraftDesignButton
                projectId={id}
                brands={brands}
                label="Draft again"
                variant="secondary"
                confirm="This replaces the current choices and reasons with a fresh draft."
              />
            </details>
          )}
        </>
      )}
    </main>
  );
}
