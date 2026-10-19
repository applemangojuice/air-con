import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  GATE_LABEL,
  ISSUE_KIND_LABEL,
  ROLE_LABEL,
  VARIATION_STATUS_LABEL,
  can,
  isOpen,
  type Issue,
  type IssueStatus,
} from "@aircon/domain";
import { Badge, StatusChip } from "@/components/kit/badge";
import { EmptyState, PageHeader } from "@/components/kit/layout";
import { Disclosure, IssueTransitionForm, RaiseIssueForm, VariationSendForm } from "@/components/ops/command/forms";
import { fmtInstant } from "@/components/ops/command/model";
import { requireStaff } from "@/lib/auth/server";
import { fmtDate, money } from "@/lib/format";
import { contractTaxRatePct } from "@/lib/variation-server";
import { issueKindDefaults } from "@/lib/ops-core-server";
import { loadProject } from "@/lib/project-service";
import * as issuesRepo from "@/lib/repo/issues";
import { raiseIssueAction, sendVariationAction, transitionIssueAction } from "../actions";

export const metadata: Metadata = { title: "Issues · ops", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NEXT: Record<IssueStatus, { value: IssueStatus; label: string }[]> = {
  open: [
    { value: "in-progress", label: "Start" },
    { value: "awaiting-customer", label: "Waiting for customer" },
    { value: "resolved", label: "Resolved" },
    { value: "rejected", label: "Reject" },
  ],
  "in-progress": [
    { value: "awaiting-customer", label: "Waiting for customer" },
    { value: "resolved", label: "Resolved" },
  ],
  "awaiting-customer": [
    { value: "in-progress", label: "Back to us" },
    { value: "resolved", label: "Resolved" },
  ],
  resolved: [
    { value: "closed", label: "Close" },
    { value: "open", label: "Reopen" },
  ],
  closed: [{ value: "open", label: "Reopen" }],
  rejected: [{ value: "open", label: "Reopen" }],
};

const owner = (i: Issue) => i.ownerName ?? (i.ownerRole === "ops" ? "Ops" : i.ownerRole === "customer" ? "Customer" : ROLE_LABEL[i.ownerRole]);

export default async function ProjectIssuesPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("projects.view-all");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [project, issues] = await Promise.all([loadProject(id), issuesRepo.listForProject(id)]);
  if (!project) notFound();
  const canEdit = can(staff, "projects.edit");
  const canPrice = can(staff, "proposal.issue") && !staff.external;
  const drafts = issues.filter((i) => i.variation?.status === "draft" && isOpen(i));
  const taxRatePct = drafts.length ? await contractTaxRatePct(id) : 0;
  const vatNote = taxRatePct > 0 ? `(${taxRatePct}% VAT is added)` : "(no VAT is charged on this contract)";
  const defaults = issueKindDefaults();
  const open = issues.filter(isOpen);
  const done = issues.filter((i) => !isOpen(i));

  return (
    <main className="mx-auto w-full min-w-0 max-w-4xl px-4 pb-16 pt-6 sm:px-6">
      <PageHeader
        back={{ href: `/ops/projects/${id}#issues`, label: project.customer.name || "Project" }}
        eyebrow={project.pilot ? `Pilot ${project.pilot.number}` : "Project"}
        title="Issues"
        subtitle={`${open.length} open, ${done.length} done. Blocking issues hold their gate until resolved.`}
      />
      {drafts.length > 0 && (
        <p role="status" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">
            {drafts.length === 1 ? "A variation from site is" : `${drafts.length} variations from site are`} waiting for the office.
          </span>{" "}
          The customer can&apos;t see {drafts.length === 1 ? "it" : "them"} yet: check the price, then send {drafts.length === 1 ? "it" : "them"} for their OK.
          {!canPrice && " Someone who can issue prices (admin or technical lead) sends it."}
        </p>
      )}
      {canEdit && (
        <section className="mb-6 rounded-2xl border border-line bg-white p-4 sm:p-5">
          <Disclosure summary="Raise an issue" open={issues.length === 0}>
            <RaiseIssueForm action={raiseIssueAction.bind(null, id)} defaults={defaults} />
          </Disclosure>
        </section>
      )}
      {issues.length === 0 ? (
        <EmptyState title="No issues on this project" body="Defects, snags, shortages and questions raised here or in the field app appear in this list." />
      ) : (
        <div className="space-y-6">
          {[
            { title: "Open", list: open },
            { title: "Done", list: done },
          ]
            .filter((g) => g.list.length)
            .map((g) => (
              <section key={g.title}>
                <h2 className="mb-2 font-display text-xl text-ink-900">{g.title}</h2>
                <ul className="space-y-3">
                  {g.list.map((i) => (
                    <li key={i.id} className="rounded-2xl border border-line bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink-900">
                            #{i.number} {i.title}
                          </p>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {ISSUE_KIND_LABEL[i.kind]} · {i.severity} · {owner(i)} · raised by {i.raisedBy.name}, {fmtInstant(i.raisedAt)}
                            {i.dueOn ? ` · due ${fmtDate(i.dueOn)}` : ""}
                          </p>
                        </div>
                        <span className="flex flex-wrap gap-1.5">
                          {i.blocking && <Badge tone="danger">Blocks {GATE_LABEL[i.gate ?? "ready-to-install"].toLowerCase()}</Badge>}
                          {i.customerVisible && <Badge tone="info">Customer sees it</Badge>}
                          <StatusChip status={i.status} />
                        </span>
                      </div>
                      {i.detail && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700">{i.detail}</p>}
                      {i.nextAction && <p className="mt-1 text-sm text-ink-700">Next: {i.nextAction}</p>}
                      {i.resolution && <p className="mt-1 text-sm text-emerald-800">Resolution: {i.resolution}</p>}
                      {i.variation && (
                        <p className="mt-1 text-sm text-ink-700">
                          Variation: {i.variation.description} · {money(i.variation.priceDeltaNetPence)} before VAT
                          {i.variation.taxPence ? `, ${money(i.variation.totalDeltaPence)} with VAT` : ""} · {VARIATION_STATUS_LABEL[i.variation.status]}
                        </p>
                      )}
                      {i.variation?.status === "draft" && isOpen(i) && canPrice && (
                        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
                          <p className="mb-2 text-sm font-semibold text-ink-900">Check it, then send it to the customer</p>
                          <VariationSendForm
                            action={sendVariationAction.bind(null, id)}
                            issueId={i.id}
                            title={i.title}
                            description={i.variation.description}
                            netPence={i.variation.priceDeltaNetPence}
                            vatNote={vatNote}
                          />
                        </div>
                      )}
                      {i.history.length > 0 && (
                        <Disclosure summary={`History (${i.history.length})`} className="mt-2">
                          <ol className="space-y-1 text-xs text-ink-700">
                            {i.history.map((h, n) => (
                              <li key={n}>
                                <span className="text-ink-500">{fmtInstant(h.at)}</span> · {h.by}
                                {h.status ? ` → ${h.status}` : ""}
                                {h.note ? `: ${h.note}` : ""}
                              </li>
                            ))}
                          </ol>
                        </Disclosure>
                      )}
                      {canEdit && (
                        <div className="mt-3 border-t border-line pt-3">
                          <IssueTransitionForm
                            action={transitionIssueAction.bind(null, id)}
                            issueId={i.id}
                            options={(NEXT[i.status] ?? []).filter((o) => !(o.value === "awaiting-customer" && i.variation?.status === "draft"))}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </main>
  );
}
