import { TAX_CODES, type CommsEventId, type Project, type ProjectAction, type ProposalOption, type ProposalRecord } from "@aircon/domain";
import { proposals } from "@/lib/repo";
import { commsForAction, type ActorLike, type AnyNotice, type Notice } from "./action-map";
import { notify, type NotifyResult } from "./outbox";
import type { OptionSummary } from "./templates";

/**
 * Every project transition that should speak, speaks (contract §H). Called
 * by `dispatch` after the reducer's result is saved, from every write path,
 * so no milestone is silent whoever moved it. The mapping itself is pure
 * (action-map.ts); this adds what only the database knows and hands each
 * notice to the outbox.
 *
 * Best-effort by design: the transition has already committed, so a
 * message failure is logged and never rolls it back or reaches the user.
 *
 * Once the acceptance email has actually gone (sent, or stored in demo
 * mode), the outbox records contract-confirmation-sent on the project (see
 * outbox.ts and followUpForDelivered): there, rather than here, so a cron
 * retry or a resend of a failed first send counts too.
 */
export async function notifyForAction(project: Project, action: ProjectAction, actor?: ActorLike | null): Promise<NotifyResult[]> {
  const results: NotifyResult[] = [];
  try {
    for (const n of commsForAction(project, action, actor)) {
      results.push(await send(await enrich(n, action), project.id));
    }
  } catch (err) {
    console.error("[comms] notifyForAction failed:", err);
  }
  return results;
}

function send<E extends CommsEventId>(n: Notice<E>, projectId: string): Promise<NotifyResult> {
  return notify(n.event, { projectId, data: n.data, discriminator: n.discriminator });
}

/** One option as the pre-contract information describes it: rooms, highlights, the total with its VAT label. */
function optionSummary(o: ProposalOption): OptionSummary {
  const taxed = o.pricing && o.pricing.taxPence > 0 ? TAX_CODES[o.pricing.taxCode]?.label : undefined;
  return {
    label: o.label,
    ...(o.summary ? { summary: o.summary } : {}),
    rooms: (o.roomCards ?? []).map((r) => `${r.roomName}: ${r.unitName}`),
    highlights: o.highlights ?? [],
    totalPence: o.pricing?.totalPence ?? 0,
    ...(taxed ? { taxLabel: taxed } : {}),
    ...(o.installDays ? { installDays: o.installDays } : {}),
  };
}

const recordDetails = (r: ProposalRecord) => ({
  inclusions: r.inclusions ?? [],
  exclusions: r.exclusions ?? [],
  assumptions: r.assumptions ?? [],
  warranty: r.warranty ?? null,
});

/**
 * The issue and acceptance emails are the durable medium, so they carry the
 * proposal record itself. The issue email: each option's rooms, highlights
 * and total price (Schedule 2 (a) and (f)). The acceptance email: the
 * acceptance record exactly as stored on the proposal (the name they typed,
 * the terms and cancellation-notice versions they saw, whether they
 * acknowledged losing the right to cancel) and the chosen option. Both fall
 * back to the project's own fields when the record isn't readable.
 */
async function enrich(n: AnyNotice, action: ProjectAction): Promise<AnyNotice> {
  if (n.event === "proposal-issued" && action.type === "proposal-issued") {
    try {
      const record = await proposals.get(action.proposalId);
      // INTEGRATION: F4 saves the issued proposal before dispatching proposal-issued.
      if (!record) {
        console.error(`[comms] proposal ${action.proposalId} not found: the issue email goes without option prices`);
        return n;
      }
      const options = (record.options ?? []).filter((o) => (o.pricing?.totalPence ?? 0) > 0).map(optionSummary);
      return { ...n, data: { ...n.data, ...recordDetails(record), ...(options.length ? { options } : {}) } };
    } catch (err) {
      console.error("[comms] couldn't read the proposal record; the issue email goes from the project:", err);
      return n;
    }
  }
  if (n.event !== "proposal-accepted" || action.type !== "proposal-accepted") return n;
  try {
    const record = await proposals.get(action.proposalId);
    const a = record?.acceptance;
    if (!a) return n; // INTEGRATION: F4 saves the acceptance on the proposal before dispatching proposal-accepted.
    const option = record.options.find((o) => o.id === a.optionId);
    return {
      ...n,
      data: {
        ...n.data,
        signedName: a.name,
        acceptedAt: a.at,
        termsVersion: a.termsVersion,
        cancellationNoticeVersion: a.cancellationNoticeVersion,
        acknowledgedLossOfRight: a.acknowledgedLossOfRight,
        earlyStartRequested: a.earlyStartRequested,
        installDays: option?.installDays ?? n.data.installDays,
        ...(option ? { option: optionSummary(option) } : {}),
        ...recordDetails(record),
      },
    };
  } catch (err) {
    console.error("[comms] couldn't read the acceptance record; sending from the project:", err);
    return n;
  }
}
