import Link from "next/link";
import type { DocumentRecord, Project, ProposalRecord } from "@aircon/domain";
import { Badge, Card, StatusChip } from "@/components/kit";
import { fmtDate, fmtDayTime, money } from "@/lib/format";

/**
 * The issued (or accepted, declined, expired) version, read-only, for ops:
 * what the customer has, what they've done with it, and the acceptance
 * record when there is one. Server-safe.
 */

const london = (iso: string) => {
  // Real instants (issuedAt, viewedAt, acceptance.at) as a London wall-clock label.
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return fmtDayTime(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00.000Z`);
};

export function IssuedSummary({ proposal, project, canSeeMargins }: { proposal: ProposalRecord; project: Project; canSeeMargins: boolean }) {
  const pp = project.proposal;
  const a = proposal.acceptance;
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-900">Version {proposal.version}</p>
            <p className="text-sm text-ink-500">
              {proposal.issuedAt ? `Issued ${london(proposal.issuedAt)}${proposal.issuedBy ? ` by ${proposal.issuedBy}` : ""}` : "Not issued"}
              {" · "}valid until {fmtDate(proposal.validUntil)}
            </p>
          </div>
          <StatusChip status={pp.proposalId === proposal.id && pp.status !== "not-issued" ? pp.status : proposal.status} />
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-2xl bg-cream p-3">
            <dt className="text-ink-500">Opened by the customer</dt>
            <dd className="font-semibold text-ink-900">{pp.viewedAt && pp.proposalId === proposal.id ? london(pp.viewedAt) : "Not yet"}</dd>
          </div>
          <div className="rounded-2xl bg-cream p-3">
            <dt className="text-ink-500">Contract</dt>
            <dd className="font-semibold text-ink-900">{(proposal.contractType ?? pp.contractType) === "install-only" ? "Install only" : "Supply and install"}</dd>
          </div>
          <div className="rounded-2xl bg-cream p-3">
            <dt className="text-ink-500">Documents by email</dt>
            <dd className="font-semibold text-ink-900">{pp.documentsByEmailConsent ? `Agreed ${fmtDate(pp.documentsByEmailConsent.at)}` : "Not agreed"}</dd>
          </div>
        </dl>
        {(proposal.changeRequest || (pp.proposalId === proposal.id && pp.changeRequest)) && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">The customer asked for changes</p>
            <p className="mt-1 whitespace-pre-line">{proposal.changeRequest ?? pp.changeRequest}</p>
          </div>
        )}
        {(proposal.declinedReason || (proposal.status === "declined" && pp.declineReason)) && (
          <div className="mt-4 rounded-2xl border border-line bg-white p-4 text-sm text-ink-700">
            <p className="font-semibold text-ink-900">Declined</p>
            <p className="mt-1">{proposal.declinedReason ?? pp.declineReason}</p>
          </div>
        )}
      </Card>

      {a && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-xl text-ink-900">Acceptance record</h3>
            <Badge tone="success">Frozen: the contract</Badge>
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Fact label="Option">{a.optionLabel}</Fact>
            <Fact label="Total">{money(a.totalPence)}</Fact>
            <Fact label="Name typed">{a.name}</Fact>
            <Fact label="When">{london(a.at)}</Fact>
            <Fact label="Early start requested">
              {a.earlyStartRequested ? (pp.earlyStart?.evidencedAt ? `Yes, evidenced ${fmtDate(pp.earlyStart.evidencedAt)}` : "Yes: waiting for their email reply (the durable copy)") : "No"}
            </Fact>
            <Fact label="Loss of right acknowledged">{a.acknowledgedLossOfRight ? "Yes" : "No (not applicable or not asked)"}</Fact>
            <Fact label="Terms / cancellation notice">
              {a.termsVersion} / {a.cancellationNoticeVersion}
            </Fact>
            <Fact label="Confirmation email">{pp.confirmationSentAt ? `Sent ${london(pp.confirmationSentAt)}` : "Not recorded yet"}</Fact>
            {a.ip && <Fact label="IP address">{a.ip}</Fact>}
            {a.documentHash && (
              <Fact label="Document fingerprint (sha256)">
                <span className="break-all font-mono text-xs">{a.documentHash}</span>
              </Fact>
            )}
          </dl>
          {a.earlyStartRequested && !pp.earlyStart?.evidencedAt && (
            <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Work can&apos;t start inside the cancellation period until their emailed early-start request is recorded as evidence (on the project&apos;s command centre).
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {proposal.options.map((o) => (
          <Card key={o.id}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-semibold text-ink-900">{o.label}</h3>
              <p className="font-semibold tabular-nums">{money(o.pricing.totalPence)}</p>
            </div>
            <p className="mt-1 text-sm text-ink-500">{o.summary}</p>
            <ul className="mt-3 space-y-1 text-sm text-ink-700">
              {o.roomCards.map((c) => (
                <li key={c.roomId}>
                  {c.roomName}: {c.unitName}
                </li>
              ))}
            </ul>
            {canSeeMargins && o.pricing.netPence > 0 && (
              <p className="mt-3 border-t border-line pt-3 text-sm text-ink-700">
                Margin {o.pricing.grossMarginPct}%{o.pricing.discount ? ` after ${o.pricing.discount.code}` : ""} · cost {money(o.pricing.costPence)}
                {o.pricing.unpricedCostLines ? ` · ${o.pricing.unpricedCostLines} unpriced` : ""}
              </p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-medium text-ink-900">{children}</dd>
    </div>
  );
}

export function VersionHistory({ proposals, documents, projectId }: { proposals: ProposalRecord[]; documents: DocumentRecord[]; projectId: string }) {
  if (proposals.length === 0) return null;
  const snapshotProposalId = (d: DocumentRecord) => {
    const s = d.snapshot as { proposal?: { id?: string }; proposalId?: string } | null;
    return s?.proposal?.id ?? s?.proposalId;
  };
  const docFor = (id: string, kind: "proposal" | "contract") => documents.find((d) => d.kind === kind && snapshotProposalId(d) === id);
  return (
    <section aria-labelledby="history-h">
      <h2 id="history-h" className="mb-3 font-display text-xl text-ink-900">
        Versions
      </h2>
      <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
        {proposals.map((p) => {
          const doc = docFor(p.id, "proposal");
          const contract = p.acceptance ? docFor(p.id, "contract") : undefined;
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">
                  Version {p.version}
                  <span className="ml-2 font-normal text-ink-500">
                    {p.options.map((o) => `${o.label} ${o.pricing.totalPence > 0 ? money(o.pricing.totalPence) : "(not priced)"}`).join(" · ")}
                  </span>
                </p>
                <p className="text-xs text-ink-500">
                  Created {fmtDate(p.createdAt)}
                  {p.issuedAt ? ` · issued ${fmtDate(p.issuedAt)}` : ""}
                  {p.acceptance ? ` · accepted ${fmtDate(p.acceptance.at)}` : ""}
                  {p.supersededBy ? " · replaced by a later version" : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {doc && (
                  // /d/[id] renders the frozen proposal document (F1).
                  <Link href={`/d/${doc.id}`} className="text-sm font-semibold text-accent-700 underline">
                    {doc.ref}
                  </Link>
                )}
                {contract && (
                  <Link href={`/d/${contract.id}`} className="text-sm font-semibold text-accent-700 underline">
                    Contract {contract.ref}
                  </Link>
                )}
                {p.status !== "draft" && (
                  <Link href={`/p/${projectId}/proposal?preview=${p.id}`} className="text-sm font-semibold text-accent-700 underline">
                    View
                  </Link>
                )}
                <StatusChip status={p.status} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
