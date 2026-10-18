import { RESCHEDULE_FEES, TAX_CODES, depositPence, type ContractType, type OptionPricing, type PilotSettings } from "@aircon/domain";
import { fmtDate, money } from "../../lib/format.ts";

/**
 * The customer proposal's settings-driven sentences, in plain words. Pure,
 * so the page, the accept flow and the tests all read the same text. Calm
 * and specific: this is money and a contract.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How VAT applies to an option's total, in a few words. */
export function vatNote(pricing: Pick<OptionPricing, "taxCode" | "taxPence">, settings: PilotSettings): string {
  if (!settings.tax.vatRegistered || pricing.taxCode === "outside-scope") return "No VAT: we're not VAT registered";
  if (pricing.taxPence > 0) return `Including VAT (${TAX_CODES[pricing.taxCode].label.replace(/^.*\((\d+%)\)$/, "$1")})`;
  return TAX_CODES[pricing.taxCode].ratePct === 0 ? "VAT at 0% on energy-saving materials" : TAX_CODES[pricing.taxCode].label;
}

const METHOD: Record<PilotSettings["payments"]["methods"][number], string> = {
  "bank-transfer": "bank transfer",
  card: "card",
};

/** The deposit F5's invoices will ask for (money.ts depositPence), so the proposal quotes exactly what the deposit invoice charges. */
const depositFor = (totalPence: number, settings: PilotSettings): number => depositPence(totalPence, settings);

/** Deposit, balance and how to pay, for one option's total. */
export function paymentTerms(totalPence: number, settings: PilotSettings): string[] {
  const p = settings.payments;
  const out: string[] = [];
  if (p.depositPct > 0) {
    const deposit = depositFor(totalPence, settings);
    out.push(
      `A ${p.depositPct}% deposit of ${money(deposit)}, ${p.depositTiming === "on-acceptance" ? "when you accept" : "before we order your equipment"}.`,
    );
    out.push(`The balance of ${money(totalPence - deposit)} once the installation is finished, due within ${plural(p.balanceDueDays, "day")} of our invoice.`);
  } else {
    out.push("No deposit.");
    out.push(`The full ${money(totalPence)} once the installation is finished, due within ${plural(p.balanceDueDays, "day")} of our invoice.`);
  }
  const methods = p.methods.map((m) => METHOD[m]);
  if (methods.length) out.push(`You can pay by ${methods.join(" or ")}.`);
  return out;
}

/** Charges beyond the price (Schedule 2 (g)): none, except a short-notice date change. */
export function extraCharges(): string {
  const bands = RESCHEDULE_FEES.installation;
  const charged = bands.filter((b) => b.feeGbp > 0).sort((a, b) => b.feeGbp - a.feeGbp)[0];
  const free = bands.filter((b) => b.feeGbp === 0).sort((a, b) => a.minDaysNotice - b.minDaysNotice)[0];
  const fee =
    charged && free ? ` The only other cost: if you move your install dates with less than ${free.minDaysNotice} days' notice, there's a ${money(charged.feeGbp * 100)} date-change fee.` : "";
  return `No delivery or other charges. If we find something we couldn't have seen at the survey, we explain it and give you the price in writing first: nothing extra is charged unless you agree.${fee}`;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** When work could start, honestly: the cancellation period comes first unless they ask to start sooner. */
export function earliestStartNote(contractType: ContractType, settings: PilotSettings, todayIso: string): string {
  const days = settings.scheduling.cancellationDays;
  if (contractType === "install-only") {
    return `You choose your dates after accepting. We normally start after your ${days}-day cancellation period, so from ${fmtDate(addDays(todayIso, days + 1))} if you accept today, or sooner if you ask us to.`;
  }
  return `You choose your dates after accepting. Because we're supplying the equipment, we normally start once your cancellation period has ended (${days} days after the equipment arrives), or sooner if you ask us to.`;
}

export function contractTypeLabel(contractType: ContractType): string {
  return contractType === "install-only" ? "Installation only: you supply the equipment" : "Supply and installation: we supply the equipment and fit it";
}

/** The early-start explanation for the accept flow, by contract type. */
export function earlyStartExplainer(contractType: ContractType, days: number): string[] {
  const proportionate =
    "You can still cancel, but if you cancel after we've started, you pay a proportionate amount for the work done up to when you tell us.";
  return contractType === "install-only"
    ? [
        `Your cancellation period runs for ${days} days from the day you accept. Normally we wait until it ends before starting work.`,
        `If you'd like us to start sooner, tick the box below. ${proportionate} Once we've fully completed the work, you lose the right to cancel.`,
      ]
    : [
        `Because we're supplying your equipment, your cancellation period only ends ${days} days after it's delivered to you. Normally we wait until then before starting.`,
        `If you'd like us to start sooner, for example straight after delivery, tick the box below. ${proportionate}`,
      ];
}
