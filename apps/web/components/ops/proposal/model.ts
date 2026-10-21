import {
  PricingError,
  buildCostLines,
  defaultOptionFor,
  pricingInputsOf,
  recomputeOption,
  type OptionContext,
  type ProposalOption,
  type ProposalRecord,
} from "@aircon/domain";
import type { DraftPatch } from "@/lib/proposal-server";

/**
 * The builder's form model: the editable fields of a draft (exactly what
 * the save action takes), and the same option assembly the server does on
 * save, so the browser previews what will be stored.
 */

export type OptionForm = DraftPatch["options"][number];

export function formFromRecord(p: ProposalRecord): DraftPatch {
  return {
    revision: p.draftRevision ?? 0,
    contractType: p.contractType ?? "supply-and-install",
    validUntil: p.validUntil.slice(0, 10),
    ...(p.increaseReason ? { increaseReason: p.increaseReason } : {}),
    ...(p.internalNotes ? { internalNotes: p.internalNotes } : {}),
    inclusions: [...p.inclusions],
    exclusions: [...p.exclusions],
    assumptions: [...p.assumptions],
    ...(p.planningNote ? { planningNote: p.planningNote } : {}),
    ...(p.planningNotApplicable ? { planningNotApplicable: p.planningNotApplicable.reason } : {}),
    options: p.options.map(optionFormFrom),
  };
}

export function optionFormFrom(o: ProposalOption): OptionForm {
  return {
    designVariantId: o.designVariantId,
    label: o.label,
    summary: o.summary,
    highlights: [...o.highlights],
    roomCards: o.roomCards.map((c) => ({
      roomId: c.roomId,
      unitName: c.unitName,
      why: c.why,
      highlights: [...c.highlights],
      ...(c.pipeNote !== undefined ? { pipeNote: c.pipeNote } : {}),
    })),
    installDays: o.installDays,
    labour: { ...o.labour },
    pricingInputs: pricingInputsOf(o),
  };
}

export interface OptionPreview {
  option: ProposalOption;
  /** Why it can't be priced as set (the price shows as not set). */
  error?: string;
}

/** The option as it will be saved: the design's defaults, the form's edits, repriced. Mirrors saveDraft. */
export function previewOption(ctx: OptionContext, form: OptionForm): OptionPreview | null {
  const variant = ctx.design.variants.find((v) => v.id === form.designVariantId);
  if (!variant) return null;
  const base = defaultOptionFor(ctx, variant);
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const option: ProposalOption = {
    ...base,
    label: clean(form.label) || base.label,
    summary: clean(form.summary),
    highlights: form.highlights.map(clean).filter(Boolean),
    roomCards: base.roomCards.map((card) => {
      const edit = form.roomCards.find((c) => c.roomId === card.roomId);
      return edit
        ? {
            ...card,
            unitName: clean(edit.unitName) || card.unitName,
            why: clean(edit.why) || card.why,
            highlights: edit.highlights.map(clean).filter(Boolean),
            ...(edit.pipeNote !== undefined ? { pipeNote: clean(edit.pipeNote) } : {}),
          }
        : card;
    }),
    installDays: form.installDays,
    labour: form.labour,
    pricingInputs: form.pricingInputs,
  };
  try {
    return { option: recomputeOption(ctx, option) };
  } catch (err) {
    if (!(err instanceof PricingError)) throw err;
    const inputs = form.pricingInputs;
    const costLines = buildCostLines({
      variant,
      catalogue: ctx.catalogue,
      labour: form.labour,
      settings: ctx.settings,
      contractType: ctx.contractType,
      ...(inputs.extras ? { extras: inputs.extras } : {}),
      ...(ctx.inHouseElectrician ? { inHouseElectrician: true } : {}),
      ...(ctx.accessEquipment ? { accessEquipment: ctx.accessEquipment } : {}),
      ...(inputs.costOverrides ? { overrides: inputs.costOverrides } : {}),
    });
    const costPence = costLines.reduce((a, l) => a + (l.totalPence ?? 0), 0);
    return {
      option: {
        ...option,
        costLines,
        priceLines: [],
        pricing: {
          ...base.pricing,
          pricingBasis: inputs.basis,
          netPence: 0,
          totalPence: 0,
          listNetPence: 0,
          taxPence: 0,
          costPence,
          unpricedCostLines: costLines.filter((l) => l.totalPence === null).length,
          grossMarginPct: 0,
          grossMarginPctBeforeDiscount: 0,
          contributionPence: 0,
          belowMinMargin: true,
        },
      },
      error: err.message,
    };
  }
}

/** A draft record from the form and previews, for proposalIssueErrors in the browser. */
export function recordFromForm(base: ProposalRecord, form: DraftPatch, options: ProposalOption[]): ProposalRecord {
  return {
    ...base,
    options,
    contractType: form.contractType,
    validUntil: form.validUntil,
    inclusions: form.inclusions,
    exclusions: form.exclusions,
    assumptions: form.assumptions,
    ...(form.increaseReason?.trim() ? { increaseReason: form.increaseReason } : { increaseReason: undefined }),
    planningNote: form.planningNote?.trim() || undefined,
    planningNotApplicable: form.planningNotApplicable?.trim() ? { reason: form.planningNotApplicable.trim(), by: "", at: "" } : undefined,
  };
}
