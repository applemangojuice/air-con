import type { CommsEventId, Project, ProjectAction } from "@aircon/domain";
import { proposals } from "@/lib/repo";
import { commsForAction, type ActorLike, type AnyNotice, type Notice } from "./action-map";
import { notify, type NotifyResult } from "./outbox";

/**
 * Every project transition that should speak, speaks (contract §H). Called
 * by `dispatch` after the reducer's result is saved, from every write path,
 * so no milestone is silent whoever moved it. The mapping itself is pure
 * (action-map.ts); this adds what only the database knows and hands each
 * notice to the outbox.
 *
 * Best-effort by design: the transition has already committed, so a
 * message failure is logged and never rolls it back or reaches the user.
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

/**
 * The acceptance email is the customer's durable copy of the contract, so
 * it carries the acceptance record exactly as stored on the proposal: the
 * name they typed, the terms and cancellation-notice versions they saw, and
 * whether they acknowledged losing the right to cancel. Falls back to the
 * project's own fields when the record isn't readable.
 */
async function enrich(n: AnyNotice, action: ProjectAction): Promise<AnyNotice> {
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
      },
    };
  } catch (err) {
    console.error("[comms] couldn't read the acceptance record; sending from the project:", err);
    return n;
  }
}
