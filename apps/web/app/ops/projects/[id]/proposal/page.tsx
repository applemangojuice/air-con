import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { can, customerSafeProposal, type OptionContext, type ProposalRecord } from "@aircon/domain";
import { Card, EmptyState, LinkButton, PageHeader, StatusChip } from "@/components/kit";
import { ProposalActionButton } from "@/components/ops/proposal/action-button";
import { ProposalBuilder } from "@/components/ops/proposal/builder";
import { IssuedSummary, VersionHistory } from "@/components/ops/proposal/summary";
import { requireProjectAccess, requireStaff } from "@/lib/auth/server";
import { fmtDate, money } from "@/lib/format";
import { loadBuilder } from "@/lib/proposal-server";

export const metadata: Metadata = {
  title: "Proposal · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /ops/projects/<id>/proposal: build, issue and revise the proposal.
 * proposal.edit to open; proposal.issue to issue; costs and margins only
 * with finance.view-margin (stripped on the server otherwise).
 */
export default async function ProposalBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("proposal.edit");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const access = await requireProjectAccess(id, { perm: "proposal.edit" });
  if (!access) notFound();
  const data = await loadBuilder(id, staff);
  if (!data) notFound();

  const { project, design, latestDesign, proposals, settings } = data;
  const canSeeMargins = can(staff, "finance.view-margin");
  const isAdmin = staff.roles.includes("admin");
  const accepted = project.proposal.status === "accepted";
  // An accepted contract is the one to show, even if someone left a draft lying around.
  const current: ProposalRecord | null = accepted ? (proposals.find((p) => p.id === project.proposal.proposalId) ?? data.current) : data.current;
  const name = project.customer.name || "Customer";
  const surveyHref = `/field/survey/${id}`;
  const designHref = `/ops/projects/${id}/design`;

  const header = (
    <PageHeader
      back={{ href: `/ops/projects/${id}`, label: name }}
      eyebrow={`Proposal${project.pilot ? ` · ${project.pilot.label}` : ""}`}
      title={name}
      subtitle={`${project.customer.addressLine}${project.customer.postcode ? `, ${project.customer.postcode}` : ""} · online estimate ${money(Math.round(project.quoteSummary.totalGbp * 100))}`}
      actions={
        current ? (
          <>
            <StatusChip status={current.status} label={current.status === "draft" ? `Draft v${current.version}` : undefined} />
            {current.status !== "draft" && (
              <LinkButton href={`/p/${id}/proposal`} variant="secondary">
                Customer&apos;s page ↗
              </LinkButton>
            )}
          </>
        ) : undefined
      }
    />
  );

  let body: React.ReactNode;
  if (!design) {
    const status = latestDesign?.status;
    body = (
      <EmptyState
        title="Waiting for an approved design"
        body={
          status === "in-review"
            ? `Design version ${latestDesign!.version} is in review. Once a technical lead signs it off, the proposal starts here from it.`
            : status === "draft"
              ? `Design version ${latestDesign!.version} is still a draft. It needs a technical lead's sign-off before anything is priced.`
              : "There's no design yet. The technical lead designs from the measured survey and signs it off; the proposal is built from that."
        }
        action={
          <LinkButton href={designHref}>Go to the design</LinkButton>
        }
      />
    );
  } else if (!current) {
    body = (
      <Card>
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h2 className="font-display text-2xl text-ink-900">Start the proposal</h2>
            <p className="mt-1 text-base text-ink-700">
              From design version {design.version}, signed off by {design.approval?.name ?? "the technical lead"}
              {design.approval?.at ? ` on ${fmtDate(design.approval.at)}` : ""}. One option per design variant, priced from the engine, with the costs from the
              catalogue and the standard wording. You can change everything before it&apos;s issued.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {design.variants.map((v) => (
                <li key={v.id} className="rounded-full bg-cream px-3 py-1 text-sm text-ink-700">
                  {v.label}: {v.roomUnits.length} room{v.roomUnits.length === 1 ? "" : "s"}, {v.installDays || settings.scheduling.installBlockDays} days
                </li>
              ))}
            </ul>
            {data.engine && <p className="mt-3 text-sm text-ink-500">{data.engine.note}</p>}
          </div>
          <ProposalActionButton kind="start" projectId={id}>
            Start the proposal
          </ProposalActionButton>
        </div>
      </Card>
    );
  } else if (current.status === "draft" && current.designId !== design.id) {
    body = (
      <Card>
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h2 className="font-display text-2xl text-ink-900">The design has changed</h2>
            <p className="mt-1 text-base text-ink-700">
              This draft (version {current.version}) was built on an earlier design. Design version {design.version} is now the approved one, so start
              the draft again from it: the rooms, units and costs all come from the design.
            </p>
          </div>
          <ProposalActionButton kind="start" projectId={id}>
            Start again from design v{design.version}
          </ProposalActionButton>
        </div>
      </Card>
    );
  } else if (current.status === "draft" && data.ctx && data.engine) {
    // Staff without margin access never receive costs: stripped here, before anything reaches the browser.
    const ctx: OptionContext = canSeeMargins ? data.ctx : { ...data.ctx, catalogue: data.ctx.catalogue.map((i) => ({ ...i, costPence: null })) };
    const proposal: ProposalRecord = canSeeMargins ? current : { ...customerSafeProposal(current), ...(current.draftRevision !== undefined ? { draftRevision: current.draftRevision } : {}) };
    body = (
      <ProposalBuilder
        projectId={id}
        proposal={proposal}
        ctx={ctx}
        engine={data.engine}
        canSeeMargins={canSeeMargins}
        canIssue={can(staff, "proposal.issue")}
        isAdmin={isAdmin}
        media={data.media}
        blockers={data.blockers}
        schedule2Missing={data.schedule2Missing}
        customer={{ name, ...(project.customer.email ? { email: project.customer.email } : {}), ...(project.proposal.documentsByEmailConsent ? { consentAt: project.proposal.documentsByEmailConsent.at } : {}) }}
        today={data.today}
        instantPricePence={Math.round(project.quoteSummary.totalGbp * 100)}
        surveyHref={surveyHref}
        designHref={designHref}
      />
    );
  } else {
    const shown = canSeeMargins ? current : customerSafeProposal(current);
    // Issued from a design that's since been replaced (F3 superseded it): the customer is looking at an old layout.
    const staleDesign = !accepted && current.status !== "accepted" && current.designId !== design.id;
    body = (
      <div className="space-y-6">
        {staleDesign && (
          <Card>
            <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <h2 className="font-display text-2xl text-ink-900">The design has changed since this proposal</h2>
                <p className="mt-1 text-base text-ink-700">
                  Version {current.version} was issued from an earlier design. Design version {design.version} is now the approved one, so the customer is
                  looking at an out-of-date layout and price. Revise it: the new draft is built from design v{design.version}, and issuing it replaces this one.
                </p>
              </div>
              <ProposalActionButton kind="revise" projectId={id} proposalId={current.id}>
                Revise from design v{design.version}
              </ProposalActionButton>
            </div>
          </Card>
        )}
        {current.status !== "accepted" && !accepted && !staleDesign && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-xl">
                <h2 className="font-semibold text-ink-900">Need to change something?</h2>
                <p className="mt-1 text-sm text-ink-700">
                  Issued versions never change. Revising copies this one into a new draft (version {current.version + 1}); issuing that replaces this one for the customer.
                </p>
              </div>
              <ProposalActionButton kind="revise" projectId={id} proposalId={current.id} variant="secondary">
                Revise: start version {current.version + 1}
              </ProposalActionButton>
            </div>
          </Card>
        )}
        {accepted && (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Accepted: this is the contract and it can&apos;t change. Any change now is a numbered variation with its own price and acceptance.
          </p>
        )}
        <IssuedSummary proposal={shown} project={project} canSeeMargins={canSeeMargins} />
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      {header}
      <div className="space-y-10">
        {body}
        <VersionHistory proposals={proposals} documents={data.documents} projectId={id} />
        <p className="text-xs text-ink-500">
          Built on {design ? `design version ${design.version}` : "no approved design yet"} ·{" "}
          <Link href={designHref} className="underline">
            design
          </Link>{" "}
          ·{" "}
          <Link href={`/ops/projects/${id}`} className="underline">
            command centre
          </Link>
        </p>
      </div>
    </main>
  );
}
