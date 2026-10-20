import {
  TAX_CODES,
  contractTaxCode,
  recordVariationEarlyStart,
  sendVariationToCustomer,
  variationHasOwnRight,
  type Issue,
  type StaffMember,
  type TaxCodeId,
} from "@aircon/domain";
import { audit } from "./audit";
import { notify } from "./comms/outbox";
import { fail, type Outcome } from "./purchasing-server";
import * as issuesRepo from "./repo/issues";
import * as proposalsRepo from "./repo/proposals";
import { getSettings, getSettingsStrict } from "./settings-server";

/**
 * Variations between the field and the customer (plan §4: variation → owner
 * → customer approval). One proposed on site is an installer's estimate: it
 * waits, invisible to the customer, until someone in the office who may
 * issue prices checks it and sends it (`sendVariation`). Only then does the
 * customer get the variation-approval email and see it in their portal.
 */

/**
 * The tax code a variation is priced on: the accepted contract option's own
 * tax treatment, not whatever settings say today (the money page invoices
 * on the same code: contractTaxCode); settings, as they must be charged,
 * only when there's no accepted contract on record. A failed read throws:
 * a price at the wrong rate is worse than "try again".
 */
export async function variationTaxCode(projectId: string): Promise<TaxCodeId> {
  const [settings, accepted] = await Promise.all([getSettingsStrict(), proposalsRepo.acceptedForProject(projectId)]);
  return contractTaxCode(accepted, settings);
}

/** The VAT rate that code charges, for the office's "VAT is added" note. */
export async function contractTaxRatePct(projectId: string): Promise<number> {
  return TAX_CODES[await variationTaxCode(projectId)]?.ratePct ?? 0;
}

/** Tell the customer a priced change is waiting for their answer. */
export async function notifyVariation(issue: Issue): Promise<void> {
  if (!issue.variation) return;
  try {
    // The customer approves or declines in the portal (/api/portal/variations); an accepted
    // variation is billed on its own or picked up by the balance invoice (planInvoices).
    // Above £42 the change has its own right to cancel: the email carries the information and the form.
    const days = variationHasOwnRight(issue.variation) ? ((await getSettings())?.scheduling.cancellationDays ?? 14) : null;
    await notify("variation-approval", {
      projectId: issue.projectId,
      data: {
        title: issue.title,
        description: issue.variation.description,
        totalDeltaPence: issue.variation.totalDeltaPence,
        issueNumber: issue.number,
        ...(days !== null ? { ownRight: { days: Math.max(14, days) } } : {}),
      },
      discriminator: issue.id,
    });
  } catch (err) {
    console.error("[variation] variation-approval failed:", err);
  }
}

/**
 * The office checked a variation proposed on site: send it to the customer
 * at the price as corrected. Permission (proposal.issue) is the caller's job.
 */
export async function sendVariation(
  projectId: string,
  issueId: string,
  input: { title?: string; description: string; priceDeltaNetPence: number },
  staff: StaffMember,
): Promise<Outcome<Issue>> {
  const issue = await issuesRepo.get(issueId);
  if (!issue || issue.projectId !== projectId) return fail("That variation isn't on this project.", 404);
  if (staff.external) return fail("Prices go to the customer from the office.", 403);
  let next: Issue;
  try {
    next = sendVariationToCustomer(issue, { ...input, taxCode: await variationTaxCode(projectId) }, staff.name, new Date().toISOString());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const saved = await issuesRepo.update(next);
  await audit({
    actor: staff,
    action: "issue.variation-sent",
    entity: "issue",
    entityId: issue.id,
    detail: { projectId, estimatedNetPence: issue.variation?.priceDeltaNetPence, sentNetPence: saved.variation?.priceDeltaNetPence },
  });
  await notifyVariation(saved);
  return { ok: true, value: saved, message: `Variation #${saved.number} sent to the customer for their OK.` };
}

/**
 * The office records the customer's written request (their reply email) to
 * start a change's extra work inside its own cancellation period; the crew
 * sees "go ahead" from then. Permission (proposal.issue) is the caller's job.
 */
export async function recordVariationStartRequest(
  projectId: string,
  issueId: string,
  input: { requestedAt: string; evidence: string },
  staff: StaffMember,
): Promise<Outcome<Issue>> {
  const issue = await issuesRepo.get(issueId);
  if (!issue || issue.projectId !== projectId) return fail("That variation isn't on this project.", 404);
  if (staff.external) return fail("The office records the customer's request.", 403);
  let next: Issue;
  try {
    next = recordVariationEarlyStart(issue, input, staff.name, new Date().toISOString());
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  const saved = await issuesRepo.update(next);
  await audit({ actor: staff, action: "issue.variation-early-start", entity: "issue", entityId: issue.id, detail: { projectId, requestedAt: saved.variation?.earlyStart?.requestedAt } });
  return { ok: true, value: saved, message: `Their request is on file: the crew can start change #${saved.number}.` };
}
