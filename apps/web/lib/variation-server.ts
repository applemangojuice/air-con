import { TAX_CODES, effectiveTaxCode, sendVariationToCustomer, type Issue, type StaffMember } from "@aircon/domain";
import { audit } from "./audit";
import { notify } from "./comms/outbox";
import { fail, type Outcome } from "./purchasing-server";
import * as issuesRepo from "./repo/issues";
import * as proposalsRepo from "./repo/proposals";
import { getSettings } from "./settings-server";

/**
 * Variations between the field and the customer (plan §4: variation → owner
 * → customer approval). One proposed on site is an installer's estimate: it
 * waits, invisible to the customer, until someone in the office who may
 * issue prices checks it and sends it (`sendVariation`). Only then does the
 * customer get the variation-approval email and see it in their portal.
 */

/**
 * The VAT rate a variation is priced at: the accepted contract option's own
 * tax treatment, not whatever settings say today; settings only when
 * there's no accepted contract on record.
 */
export async function contractTaxRatePct(projectId: string): Promise<number> {
  const settings = await getSettings();
  let taxCode = effectiveTaxCode(settings);
  const accepted = await proposalsRepo.acceptedForProject(projectId).catch(() => null);
  const option = accepted?.acceptance ? accepted.options.find((o) => o.id === accepted.acceptance!.optionId) : undefined;
  if (option?.pricing.taxCode && TAX_CODES[option.pricing.taxCode]) taxCode = option.pricing.taxCode;
  return TAX_CODES[taxCode]?.ratePct ?? 0;
}

/** Tell the customer a priced change is waiting for their answer. */
export async function notifyVariation(issue: Issue): Promise<void> {
  if (!issue.variation) return;
  try {
    // The customer approves or declines in the portal (/api/portal/variations); an accepted
    // variation is billed on its own or picked up by the balance invoice (planInvoices).
    await notify("variation-approval", {
      projectId: issue.projectId,
      data: {
        title: issue.title,
        description: issue.variation.description,
        totalDeltaPence: issue.variation.totalDeltaPence,
        issueNumber: issue.number,
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
    next = sendVariationToCustomer(issue, { ...input, taxRatePct: await contractTaxRatePct(projectId) }, staff.name, new Date().toISOString());
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
