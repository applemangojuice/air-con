import type { CatalogueItem } from "./catalogue.ts";
import {
  PricingError,
  buildCostLines,
  roundToPound,
  defaultLabourPlan,
  priceOption,
  type AccessEquipment,
  type CostLine,
  type CostOverride,
  type LabourPlan,
  type OptionPricing,
  type PriceLine,
} from "./costing.ts";
import { planningNoiseFlags, type DesignRecord, type DesignVariant, type RoomDesignInput } from "./design-record.ts";
import type { ContractType, DocumentsConsentRecord, ReadinessContext } from "./project.ts";
import { TAX_CODES, effectiveTaxCode, type PilotSettings, type TaxCodeId } from "./settings.ts";

/**
 * The proposal: one or two priced options built on an approved design,
 * plus the customer's acceptance record.
 *
 * Versioned and immutable once accepted. Changes before acceptance make a
 * new version (`reviseProposal`); changes after it are numbered variations
 * (issues.ts). The customer view strips costs, margins and overrides.
 *
 * Plain English throughout: the default wording below is what a customer
 * reads before they're bound, so it promises only what we do and says
 * plainly what we don't.
 */

export interface RoomCard {
  roomId: string;
  roomName: string;
  unitName: string;
  why: string;
  highlights: string[];
  mediaIds: string[];
  /** "About 6 m of pipe, straight through the wall behind the unit…": the room's line in "How the pipes run". */
  pipeNote?: string;
}

/**
 * What the builder set to price an option, kept so a reload shows the same
 * inputs. Internal: customerSafeProposal drops it.
 */
export interface PricingInputs {
  basis: OptionPricing["pricingBasis"];
  /** cost-plus: the gross margin to price to (default: the minimum margin). */
  targetMarginPct?: number;
  manualNetPence?: number;
  manualReason?: string;
  discountCode?: string;
  customDiscountPence?: number;
  discountReason?: string;
  /** VAT registered only: an admin's override of the settings' tax code (the record's taxOverride says why). */
  taxCode?: TaxCodeId;
  /** Unit costs typed in for lines the catalogue can't price, ex VAT, by cost line id. */
  costOverrides?: Record<string, CostOverride>;
  /** Extra internal cost lines (ex VAT). */
  extras?: CostLine[];
}

export interface ProposalOption {
  id: string;
  label: string;
  tier: "standard" | "premium";
  designVariantId: string;
  summary: string;
  highlights: string[];
  roomCards: RoomCard[];
  outdoorMediaIds: string[];
  priceLines: PriceLine[];
  costLines: CostLine[];
  labour: LabourPlan;
  pricing: OptionPricing;
  installDays: number;
  pricingInputs?: PricingInputs;
}

export interface AcceptanceRecord {
  optionId: string;
  optionLabel: string;
  totalPence: number;
  name: string;
  email?: string;
  termsVersion: string;
  cancellationNoticeVersion: string;
  acknowledgedCancellationInfo: true;
  earlyStartRequested: boolean;
  acknowledgedLossOfRight: boolean;
  at: string;
  ip?: string;
  userAgent?: string;
  /** sha256 of the customer-safe proposal content they accepted (proposalDocumentContent, canonical JSON). */
  documentHash?: string;
  proposalVersion?: number;
  contractType?: ContractType;
  /** EARLY_START_WORDING_VERSION of the early-start wording they were shown. */
  earlyStartWordingVersion?: string;
  /** When they agreed to get the contract documents by email. */
  documentsByEmailConsentAt?: string;
  /**
   * That agreement as it stood when they accepted (reg 10(2)): how, the
   * words and their version, the address it covers, and for one staff
   * recorded, who and where the evidence is.
   */
  documentsByEmailConsent?: DocumentsConsentRecord;
  /** sha256 of the canonical JSON of the terms text they were shown (ProposalRecord.termsText). */
  termsHash?: string;
}

/** One numbered section of our terms, as text (the /terms page and the copy frozen on each proposal). */
export interface TermsSection {
  id: string;
  title: string;
  items: string[];
}

export interface ProposalRecord {
  id: string;
  projectId: string;
  version: number;
  status: "draft" | "issued" | "accepted" | "declined" | "superseded" | "expired";
  designId: string;
  designVersion: number;
  options: ProposalOption[];
  inclusions: string[];
  exclusions: string[];
  assumptions: string[];
  /** The manufacturer's warranty wording (settings), or null when none is stated. */
  warranty: string | null;
  validUntil: string;
  termsVersion: string;
  instantPriceGbp: number;
  increaseReason?: string;
  marginOverride?: { reason: string; by: string; at: string };
  taxOverride?: { reason: string; by: string; at: string };
  issuedAt?: string;
  issuedBy?: string;
  viewedAt?: string;
  acceptance?: AcceptanceRecord;
  declinedReason?: string;
  changeRequest?: string;
  supersededBy?: string;
  createdAt: string;
  /** Who supplies the kit; decides the cancellation clock and copy. supply-and-install when absent. */
  contractType?: ContractType;
  /** Guarantee and after-sales statements, from settings while a draft (withSettingsWording), frozen at issue. */
  guarantees?: string[];
  /**
   * The payment terms and cancellation days this version was issued on
   * (withSettingsWording), frozen at issue and covered by the document hash:
   * the page, both contract emails, the contract and the deposit invoice
   * all read these, never today's settings (settingsForProposal).
   */
  terms?: ProposalTerms;
  /**
   * The full text of our terms (termsVersion) as this version was issued:
   * shown before acceptance, emailed, copied into the contract and covered
   * by the document hash, so the text that applied can always be shown.
   */
  termsText?: TermsSection[];
  /**
   * The design's own planning or noise check (unit count, size, noise) was
   * in review or blocked for an option: what the customer is told about it
   * (customer-visible, printed with what's included and covered by the
   * document hash). Never a conclusion that planning is or isn't needed.
   */
  planningNote?: string;
  /** Internal: why that check doesn't need a note to the customer (recorded instead of a note). Never shown to the customer. */
  planningNotApplicable?: { reason: string; by: string; at: string };
  /** Internal notes for the team. Never shown to the customer. */
  internalNotes?: string;
  /** Bumped on every draft save, so two people editing can't silently overwrite each other. */
  draftRevision?: number;
}

/* ------------------------------------------------------------------ */
/* Default wording                                                     */
/* ------------------------------------------------------------------ */

/** The pipe each room's price allows for, unless a longer run was measured and priced. */
export const DEFAULT_PIPE_ALLOWANCE_M = 5;

export const DEFAULT_INCLUSIONS: string[] = [
  "Fitting each indoor unit in the position shown on your photos, and the outdoor unit on its wall bracket or ground feet",
  "One standard 65 mm hole through the wall for each indoor unit's pipes, sealed inside and out",
  `Up to ${DEFAULT_PIPE_ALLOWANCE_M} m of insulated refrigerant pipe per room (or the longer run measured at your survey, where your proposal shows one), in neat white trunking where it runs outside`,
  "Condensate drainage for each indoor unit, by gravity to outside or a suitable drain, or through a small pump where your proposal says one is needed",
  "A new dedicated electrical circuit from your fuse board to the outdoor unit, with an outdoor isolator, fitted, tested and certified by a Part P registered electrician",
  "Pressure testing, vacuum and commissioning by an F-gas certified engineer, in heating and cooling, with the readings recorded for you",
  "Making good inside around every hole we drill: filled and smoothed, ready for your own paint",
  "A handover on the day: the remote and the app, cleaning the filters, and what's normal (like a little steam from the outdoor unit in winter)",
  "Taking away all the packaging and waste from the installation",
];

export const DEFAULT_EXCLUSIONS: string[] = [
  "Redecorating: we fill and smooth around our holes, but painting or wallpapering is yours",
  "Structural or building work, such as lintels or opening up walls, ceilings or floors, unless your proposal lists it",
  "Removing or treating asbestos. If we suspect it, we stop work and talk to you before going any further",
  "Replacing or upgrading your fuse board, unless your proposal lists it",
  "Planning permission or listed building consent, if your home needs it. We'll tell you if we think it does",
  "Repairs to faults in your existing wiring, beyond the new circuit we fit",
  "Moving heavy furniture, or lifting and relaying carpets and floorboards",
];

/**
 * The contract calls this DEFAULT_ASSUMPTIONS; renamed because
 * intelligence.ts already exports DEFAULT_ASSUMPTIONS (campaign maths) from
 * the same package index.
 */
export const DEFAULT_PROPOSAL_ASSUMPTIONS: string[] = [
  "The unit positions and pipe routes are the ones agreed at your survey and shown on your photos",
  "Your fuse board has room for the new circuit, as we found at the survey",
  "The walls we drill are ordinary brick or block",
  "We can reach every unit position safely from a ladder, unless your proposal includes access equipment",
  "There's somewhere to park or unload within a short walk of your front door on the install days",
  "An adult is at home to let us in each day and for the handover",
  "If we find something we couldn't have seen at the survey that changes the job, we stop, explain it and give you the price in writing first. Nothing extra is charged unless you agree to it",
];

/**
 * The guarantee and after-sales statements, in plain words, from settings:
 * the manufacturer's warranty, our workmanship guarantee if we give one,
 * and the statutory rights line. When neither is set it says plainly that
 * no extended warranty is offered.
 */
export function guaranteeLines(settings: PilotSettings, manufacturerText?: string | null): string[] {
  const manufacturer = (manufacturerText ?? settings.warranty.manufacturerSummary)?.trim();
  const years = settings.warranty.workmanshipYears;
  const terms = settings.company.workmanshipGuarantee?.trim();
  const out: string[] = [];
  if (manufacturer) out.push(`Manufacturer's warranty: ${manufacturer}`);
  if (years !== null && years > 0) {
    out.push(`Our workmanship guarantee: ${years} year${years === 1 ? "" : "s"}.${terms ? ` ${terms}` : ""}`);
  } else if (years === 0) {
    out.push("We don't offer a separate guarantee on our workmanship.");
  } else if (terms) {
    out.push(`Our workmanship guarantee: ${terms}`);
  }
  if (!manufacturer) {
    out.push(
      years === null && !terms
        ? "We don't offer an extended warranty: your equipment comes with the manufacturer's standard terms."
        : "Your equipment also comes with the manufacturer's standard warranty terms.",
    );
  }
  out.push(
    "None of this affects your statutory rights: the equipment must be as described and of satisfactory quality, and our work done with reasonable care and skill.",
  );
  return out;
}

/** The payment terms a proposal is offered on (Schedule 2 (u), (j)), its cancellation days and the time we undertake to finish by. */
export interface ProposalTerms {
  depositPct: number;
  depositTiming: PilotSettings["payments"]["depositTiming"];
  balanceDueDays: number;
  methods: PilotSettings["payments"]["methods"];
  cancellationDays: number;
  /** Schedule 2 (j): weeks from acceptance to a finished installation. Absent on proposals issued before it was frozen. */
  installWithinWeeks?: number;
}

export function proposalTermsFrom(settings: PilotSettings): ProposalTerms {
  const p = settings.payments;
  return {
    depositPct: p.depositPct,
    depositTiming: p.depositTiming,
    balanceDueDays: p.balanceDueDays,
    methods: [...p.methods],
    cancellationDays: settings.scheduling.cancellationDays,
    installWithinWeeks: settings.scheduling.installWithinWeeks,
  };
}

/**
 * Schedule 2 (j), in one sentence everywhere it's said (the proposal page,
 * both contract emails, the contract): the time by which we undertake to
 * finish, from acceptance, with the dates agreed inside it.
 */
export function performanceCommitment(weeks: number): string {
  return `We'll finish your installation within ${weeks} weeks of the day you accept, on dates agreed with you. If you choose later dates, it's by then instead.`;
}

/** The date that commitment runs to, from the day they accepted (yyyy-mm-dd). */
export function performanceDueOn(acceptedAtIso: string, weeks: number): string {
  const d = new Date(`${acceptedAtIso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Settings as a proposal was issued: today's settings with the proposal's
 * frozen terms laid over them, so everything downstream of an issued or
 * accepted proposal (its page, its emails, the contract, the deposit) says
 * and charges what the customer was offered. A record without frozen terms
 * (a draft, or one issued before terms were frozen) gets today's settings.
 */
export function settingsForProposal(settings: PilotSettings, record: Pick<ProposalRecord, "terms"> | null | undefined): PilotSettings {
  const t = record?.terms;
  if (!t) return settings;
  return {
    ...settings,
    payments: { ...settings.payments, depositPct: t.depositPct, depositTiming: t.depositTiming, balanceDueDays: t.balanceDueDays, methods: [...t.methods] },
    scheduling: {
      ...settings.scheduling,
      cancellationDays: Math.max(t.cancellationDays, 14),
      ...(typeof t.installWithinWeeks === "number" ? { installWithinWeeks: t.installWithinWeeks } : {}),
    },
  };
}

/**
 * The tax code the contract is on: the accepted option's own, else (no
 * accepted contract on record) the settings default as it must be charged
 * (effectiveTaxCode). Invoices, credit notes and variations all use it, so
 * a change priced on site is billed at the rate it was priced at.
 */
export function contractTaxCode(proposal: Pick<ProposalRecord, "options" | "acceptance"> | null | undefined, settings: PilotSettings): TaxCodeId {
  const accepted = proposal?.acceptance ? proposal.options.find((o) => o.id === proposal.acceptance!.optionId) : undefined;
  const code = accepted?.pricing?.taxCode;
  return code && Object.prototype.hasOwnProperty.call(TAX_CODES, code) ? code : effectiveTaxCode(settings);
}

/**
 * What the project's gates need to know about its latest proposal. Both
 * readiness builders (project-service and the board's in-memory one) use
 * this, so they can't drift apart.
 */
export function proposalCheckFor(
  proposal: Pick<ProposalRecord, "options" | "marginOverride" | "taxOverride" | "validUntil">,
  settings: PilotSettings,
  todayIso: string,
): NonNullable<ReadinessContext["proposalCheck"]> {
  const options = proposal.options ?? [];
  return {
    belowMinMargin: options.some((o) => o.pricing?.belowMinMargin === true),
    marginOverride: Boolean(proposal.marginOverride),
    taxConfirmed: !settings.tax.vatRegistered || settings.tax.accountantConfirmed,
    taxOverride: Boolean(proposal.taxOverride),
    expired: Boolean(proposal.validUntil) && proposal.validUntil.slice(0, 10) < todayIso.slice(0, 10),
    unpricedCostLines: options.reduce((n, o) => n + Math.max(0, o.pricing?.unpricedCostLines ?? 0), 0),
  };
}

/**
 * The payment schedule an accepted proposal froze at issue (its deposit
 * percentage and timing, and the balance's due days), for the booking gate
 * and the deposit due; undefined until there's a contract.
 */
export function agreedPaymentsFor(
  proposal: Pick<ProposalRecord, "status" | "terms"> | null | undefined,
  settings: PilotSettings,
): ReadinessContext["agreedPayments"] {
  if (!proposal || proposal.status !== "accepted") return undefined;
  const p = settingsForProposal(settings, proposal).payments;
  return { depositPct: p.depositPct, depositTiming: p.depositTiming, balanceDueDays: p.balanceDueDays };
}

/**
 * A draft with its settings-derived wording (manufacturer's warranty,
 * guarantee lines, terms version) taken from the settings as they are now.
 * A draft follows settings until it's issued, so issuing refreshes it: a
 * guarantee or terms change saved after the draft's last edit must still
 * reach the customer. Issued versions are frozen and returned unchanged.
 */
export function withSettingsWording(record: ProposalRecord, settings: PilotSettings): ProposalRecord {
  if (record.status !== "draft") return record;
  return {
    ...record,
    warranty: settings.warranty.manufacturerSummary?.trim() || null,
    guarantees: guaranteeLines(settings),
    termsVersion: settings.legal.termsVersion,
    terms: proposalTermsFrom(settings),
  };
}

export interface InstallDayPlan {
  day: number;
  title: string;
  items: string[];
}

const PLAN_PREP = [
  "Protect your floors and furniture, and photograph how everything looks before we start",
  "Mark out each unit and check the wall for hidden pipes and cables",
  "Drill and seal the holes, and fit the wall brackets and the outdoor unit's base or bracket",
];
const PLAN_FIT = [
  "Check the equipment against your order",
  "Hang the indoor units and set the outdoor unit in place",
  "Run, insulate and cover the pipes and drains",
  "The electrician fits the new circuit (the power is off for about 30 minutes)",
];
const PLAN_COMMISSION = [
  "Pressure test and vacuum the pipework, then release the refrigerant and leak check",
  "Commission every room in heating and cooling, and test the electrics",
  "Show you how everything works, then tidy up and take the waste away",
];

/** The install days in plain words, for the proposal's "your three-day plan". */
export function installPlan(days: number): InstallDayPlan[] {
  const n = Math.max(1, Math.round(days || 1));
  if (n === 1) return [{ day: 1, title: "Install, commission and hand over", items: [...PLAN_PREP, ...PLAN_FIT, ...PLAN_COMMISSION] }];
  if (n === 2) {
    return [
      { day: 1, title: "Prep, building work and units", items: [...PLAN_PREP, ...PLAN_FIT.slice(0, 2)] },
      { day: 2, title: "Pipes, power, commissioning and handover", items: [...PLAN_FIT.slice(2), ...PLAN_COMMISSION] },
    ];
  }
  const middle = Array.from({ length: n - 2 }, (_, i) => ({
    day: i + 2,
    title: n === 3 ? "Units, pipes and power" : `Units, pipes and power (day ${i + 1} of ${n - 2})`,
    items: PLAN_FIT,
  }));
  return [
    { day: 1, title: "Prep and building work", items: PLAN_PREP },
    ...middle,
    { day: n, title: "Test, commission and hand over", items: PLAN_COMMISSION },
  ];
}

/* ------------------------------------------------------------------ */
/* Options from the design                                             */
/* ------------------------------------------------------------------ */

export type PipeRoute = "through-wall" | "external-trunking" | "internal-concealed" | "via-loft" | "other";

/** Everything an option is built from besides its own inputs. */
export interface OptionContext {
  design: DesignRecord;
  catalogue: CatalogueItem[];
  settings: PilotSettings;
  /** engineListNetPence for the surveyed design (0 when it couldn't be worked out). */
  engineNetPence: number;
  contractType: ContractType;
  inHouseElectrician?: boolean;
  accessEquipment?: AccessEquipment[];
  /** The approved outdoor position photos, per design system id. */
  outdoorMediaBySystem?: Record<string, string[]>;
  /** The measured route of each room's pipes (from the survey), by room id. */
  routes?: Record<string, { route?: PipeRoute; routeNote?: string }>;
}

const trimNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "We chose 2.5 kW: …", from the design's sizing (rule of thumb, signed off by the technical lead). */
export function whyThisSize(room: Pick<RoomDesignInput, "chosenKw" | "preliminaryLoadW" | "reason">): string {
  const kw = trimNum(room.chosenKw);
  const need = room.preliminaryLoadW > 0 ? Math.round(room.preliminaryLoadW / 100) / 10 : null;
  const base =
    need !== null
      ? `We chose ${kw} kW. On a hot day this room needs about ${trimNum(need)} kW, so this size keeps it comfortable without working flat out, and it heats the room on cold evenings too.`
      : `We chose ${kw} kW for this room's size and how it's used, so it stays comfortable without working flat out.`;
  return room.reason?.trim() ? `${base} Our engineer's note: ${room.reason.trim()}` : base;
}

const ROUTE_WORDS: Record<PipeRoute, string> = {
  "through-wall": "straight through the wall behind the unit",
  "external-trunking": "outside, in neat white trunking down the wall",
  "internal-concealed": "hidden inside the wall or boxing",
  "via-loft": "up through the loft",
  other: "along the route we agreed with you",
};

/** One room's line in "How the pipes run". */
export function pipeNoteFor(room: Pick<RoomDesignInput, "pipeRunM" | "heightDiffM" | "condensate">, route?: { route?: PipeRoute; routeNote?: string }): string {
  const parts: string[] = [];
  const how = route?.route ? (route.route === "other" && route.routeNote?.trim() ? route.routeNote.trim() : ROUTE_WORDS[route.route]) : undefined;
  const run = room.pipeRunM > 0 ? `About ${trimNum(room.pipeRunM)} m of pipe to the outdoor unit` : "The pipes run to the outdoor unit";
  parts.push(`${run}${how ? `, ${how}` : ""}${room.heightDiffM > 0 ? `, with a ${trimNum(room.heightDiffM)} m change in height` : ""}.`);
  parts.push(
    room.condensate === "pump"
      ? "The water the unit makes drains through a small, quiet pump."
      : "The water the unit makes drains away by gravity.",
  );
  return parts.join(" ");
}

/**
 * Every room card with its line in "How the pipes run": a card that never
 * had one (built before pipe notes, or by hand) gets it from the design the
 * proposal was built on, so the section is never missing. A note the office
 * cleared on purpose (an empty string) stays cleared. Cards with no design
 * room to go by are left as they are.
 */
export function withPipeNotes(options: ProposalOption[], design: Pick<DesignRecord, "rooms"> | null | undefined): ProposalOption[] {
  if (!design?.rooms?.length) return options;
  const rooms = new Map(design.rooms.map((r) => [r.roomId, r]));
  return options.map((o) => {
    if (o.roomCards.every((c) => c.pipeNote !== undefined || !rooms.has(c.roomId))) return o;
    return {
      ...o,
      roomCards: o.roomCards.map((c) => {
        const room = rooms.get(c.roomId);
        return c.pipeNote !== undefined || !room ? c : { ...c, pipeNote: pipeNoteFor(room, room.route ? { route: room.route } : undefined) };
      }),
    };
  });
}

/**
 * The unit's points for its room card: the catalogue blurb, then the facts
 * from its specs that the blurb doesn't already make (a card that says
 * "As quiet as 19 dB(A)… with Wi-Fi app control" doesn't then say "19 dB on
 * its quietest setting" and "App control" as well).
 */
export function unitHighlights(item: Pick<CatalogueItem, "customerBlurb" | "specs"> | undefined): string[] {
  if (!item) return [];
  const out: string[] = [];
  const blurb = item.customerBlurb?.trim() ?? "";
  if (blurb) out.push(blurb);
  const db = item.specs?.soundPressureLowDb;
  if (typeof db === "number" && !/\bdB\b/i.test(blurb)) out.push(`${trimNum(db)} dB on its quietest setting`);
  if (typeof item.specs?.heatingKw === "number" && !/\bheat/i.test(blurb)) out.push("Heats in winter as well as cooling in summer");
  if (item.specs?.wifi && !/\b(app|wi-?fi)\b/i.test(blurb)) out.push("App control");
  return out;
}

/** A room card per room in the variant, from the design and the catalogue. */
export function roomCardsFor(ctx: OptionContext, variant: DesignVariant): RoomCard[] {
  const byId = new Map(ctx.catalogue.map((i) => [i.id, i]));
  return ctx.design.rooms
    .filter((r) => variant.roomUnits.some((u) => u.roomId === r.roomId))
    .map((room) => {
      const unit = variant.roomUnits.find((u) => u.roomId === room.roomId)!;
      const item = byId.get(unit.indoorItemId);
      return {
        roomId: room.roomId,
        roomName: room.roomName,
        unitName: item ? item.label.trim() : "Wall-mounted indoor unit",
        why: whyThisSize(room),
        highlights: unitHighlights(item),
        mediaIds: [...room.layoutMediaIds],
        pipeNote: pipeNoteFor(room, ctx.routes?.[room.roomId]),
      };
    });
}

/**
 * The customer's price lines: one per system (its rooms, supplied and
 * installed), splitting the net price by each system's equipment cost (by
 * room count when the catalogue has no costs), the last line taking the
 * rounding, then VAT when charged. They always add up to the total. There is
 * deliberately no discount line: a new trader shows its pilot price, never a
 * "was £X" (DMCC Act 2024, reference pricing).
 */
export function priceLinesFor(ctx: OptionContext, variant: DesignVariant, pricing: OptionPricing): PriceLine[] {
  const byId = new Map(ctx.catalogue.map((i) => [i.id, i]));
  const roomName = new Map(ctx.design.rooms.map((r) => [r.roomId, r.roomName]));
  const supply = ctx.contractType !== "install-only";
  const systems = variant.systems;
  const weights = systems.map((s) => {
    const indoor = variant.roomUnits.filter((u) => s.roomIds.includes(u.roomId)).map((u) => byId.get(u.indoorItemId)?.costPence ?? 0);
    return (byId.get(s.outdoorItemId)?.costPence ?? 0) + indoor.reduce((a, b) => a + b, 0);
  });
  const useCost = weights.every((w) => w > 0);
  const share = systems.map((s, i) => (useCost ? weights[i]! : Math.max(1, s.roomIds.length)));
  const total = share.reduce((a, b) => a + b, 0) || 1;
  let left = pricing.netPence;
  const lines: PriceLine[] = systems.map((s, i) => {
    const amount = i === systems.length - 1 ? left : roundToPound((pricing.netPence * share[i]!) / total);
    left -= amount;
    const names = s.roomIds.map((id) => roomName.get(id) ?? "Room");
    const outdoor = byId.get(s.outdoorItemId);
    const n = s.roomIds.length;
    return {
      id: `${variant.id}:system:${s.id}`,
      label: `${names.join(", ")}: ${supply ? "supply and installation" : "installation"}`,
      detail: `${n} indoor unit${n === 1 ? "" : "s"} and ${outdoor ? outdoor.label.trim() : "the outdoor unit"}${supply ? "" : " (equipment supplied by you)"}, with pipework, the electrical circuit, commissioning and handover`,
      amountPence: amount,
      kind: "system" as const,
    };
  });
  if (systems.length === 0) {
    lines.push({ id: `${variant.id}:system`, label: supply ? "Supply and installation" : "Installation", amountPence: pricing.netPence, kind: "system" });
  }
  if (pricing.taxPence > 0) {
    lines.push({ id: `${variant.id}:vat`, label: TAX_CODES[pricing.taxCode].label, amountPence: pricing.taxPence, kind: "fee" });
  }
  return lines;
}

const OPTION_COPY: Record<"standard" | "premium", { summary: string; highlight: string }> = {
  standard: {
    summary: "Efficient units sized to each room, keeping you cool in summer and warm in winter.",
    highlight: "Heats and cools every room in the design",
  },
  premium: {
    summary: "Our quietest units, for bedrooms and anyone who sleeps lightly, with the same heating and cooling.",
    highlight: "Our quietest indoor units",
  },
};

/** The pricing inputs an option starts with: the engine price (cost-plus for install-only, which the engine can't price). */
export function defaultPricingInputs(ctx: OptionContext): PricingInputs {
  return ctx.contractType === "install-only" || ctx.engineNetPence <= 0 ? { basis: "cost-plus" } : { basis: "engine" };
}

/** Cost lines, pricing and price lines for an option, from its labour plan and pricing inputs. Throws PricingError. */
export function recomputeOption(ctx: OptionContext, option: ProposalOption): ProposalOption {
  const variant = ctx.design.variants.find((v) => v.id === option.designVariantId);
  if (!variant) throw new PricingError(`The design has no "${option.label}" variant any more.`);
  const inputs = option.pricingInputs ?? defaultPricingInputs(ctx);
  const costLines = buildCostLines({
    variant,
    catalogue: ctx.catalogue,
    labour: option.labour,
    settings: ctx.settings,
    contractType: ctx.contractType,
    ...(inputs.extras ? { extras: inputs.extras } : {}),
    ...(ctx.inHouseElectrician ? { inHouseElectrician: true } : {}),
    ...(ctx.accessEquipment ? { accessEquipment: ctx.accessEquipment } : {}),
    ...(inputs.costOverrides ? { overrides: inputs.costOverrides } : {}),
  });
  const pricing = priceOption({
    costLines,
    basis: inputs.basis,
    engineNetPence: ctx.engineNetPence,
    settings: ctx.settings,
    tier: option.tier,
    ...(inputs.manualNetPence !== undefined ? { manualNetPence: inputs.manualNetPence } : {}),
    ...(inputs.manualReason !== undefined ? { manualReason: inputs.manualReason } : {}),
    ...(inputs.discountCode ? { discountCode: inputs.discountCode } : {}),
    ...(inputs.customDiscountPence !== undefined ? { customDiscountPence: inputs.customDiscountPence } : {}),
    ...(inputs.discountReason !== undefined ? { discountReason: inputs.discountReason } : {}),
    ...(inputs.targetMarginPct !== undefined ? { targetMarginPct: inputs.targetMarginPct } : {}),
    ...(inputs.taxCode ? { taxCode: inputs.taxCode } : {}),
  });
  return { ...option, pricingInputs: inputs, costLines, pricing, priceLines: priceLinesFor(ctx, variant, pricing) };
}

/** A fresh option for a design variant, priced with the default inputs where it can be (never throws PricingError). */
export function defaultOptionFor(ctx: OptionContext, variant: DesignVariant): ProposalOption {
  const copy = OPTION_COPY[variant.tier];
  const cards = roomCardsFor(ctx, variant);
  const quietest = cards
    .flatMap((c) => c.highlights)
    .map((h) => /^(\d+(?:\.\d)?) dB on its quietest setting$/.exec(h)?.[1])
    .filter((v): v is string => Boolean(v))
    .map(Number);
  const highlights = [
    variant.tier === "premium" && quietest.length ? `As quiet as ${trimNum(Math.min(...quietest))} dB on the lowest setting` : copy.highlight,
    `${variant.installDays || ctx.settings.scheduling.installBlockDays}-day installation`,
    "Designed on your own photos and signed off by our engineer",
  ];
  const outdoor = variant.systems.flatMap((s) => ctx.outdoorMediaBySystem?.[s.id] ?? []);
  const option: ProposalOption = {
    id: `${variant.id}-option`,
    label: variant.label,
    tier: variant.tier,
    designVariantId: variant.id,
    summary: copy.summary,
    highlights,
    roomCards: cards,
    outdoorMediaIds: [...new Set(outdoor)],
    priceLines: [],
    costLines: [],
    labour: defaultLabourPlan(variant, ctx.settings),
    pricing: {
      pricingBasis: "engine",
      listNetPence: 0,
      netPence: 0,
      taxCode: effectiveTaxCode(ctx.settings),
      taxPence: 0,
      totalPence: 0,
      costPence: 0,
      unpricedCostLines: 0,
      grossMarginPct: 0,
      grossMarginPctBeforeDiscount: 0,
      contributionPence: 0,
      belowMinMargin: true,
    },
    installDays: variant.installDays || ctx.settings.scheduling.installBlockDays,
    pricingInputs: defaultPricingInputs(ctx),
  };
  // The engine first (cost-plus for install-only), then cost-plus; failing
  // both (no engine price, nothing costed yet) it waits for a manual price.
  for (const basis of [option.pricingInputs!.basis, "cost-plus"] as const) {
    try {
      return recomputeOption(ctx, { ...option, pricingInputs: { basis } });
    } catch (err) {
      if (!(err instanceof PricingError)) throw err;
    }
  }
  const costLines = buildCostLines({
    variant,
    catalogue: ctx.catalogue,
    labour: option.labour,
    settings: ctx.settings,
    contractType: ctx.contractType,
    ...(ctx.inHouseElectrician ? { inHouseElectrician: true } : {}),
    ...(ctx.accessEquipment ? { accessEquipment: ctx.accessEquipment } : {}),
  });
  return {
    ...option,
    costLines,
    pricing: { ...option.pricing, unpricedCostLines: costLines.filter((l) => l.totalPence === null).length },
    pricingInputs: { basis: "manual" },
  };
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const dateOf = (iso: string) => iso.slice(0, 10);

function addDays(iso: string, n: number): string {
  const d = new Date(`${dateOf(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso: string) => {
  const d = new Date(`${dateOf(iso)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** The default valid-until date: today + the validity in settings. */
export function defaultValidUntil(settings: PilotSettings, todayIso: string): string {
  return addDays(todayIso, Math.max(1, settings.pricing.quoteValidityDays));
}

/** Past its valid-until date (the date itself is still valid). */
export function isProposalExpired(p: Pick<ProposalRecord, "validUntil">, todayIso: string): boolean {
  return Boolean(p.validUntil) && dateOf(p.validUntil) < dateOf(todayIso);
}

/* ------------------------------------------------------------------ */
/* Drafting                                                            */
/* ------------------------------------------------------------------ */

/**
 * The first draft from an approved design: one option per variant (Standard,
 * Quiet), the default wording, the warranty from settings and a validity of
 * today + settings. Variants the catalogue can't price stay in with an
 * unpriced cost build-up; a variant that can't be priced at all (no engine
 * price and no costs) is still drafted, waiting for a manual price, which
 * proposalIssueErrors insists on before issue.
 */
export function draftProposal(
  ctx: OptionContext,
  input: { id: string; projectId: string; version: number; instantPriceGbp: number; today: string; now: string },
): ProposalRecord {
  const options = ctx.design.variants.map((v) => defaultOptionFor(ctx, v));
  return {
    id: input.id,
    projectId: input.projectId,
    version: input.version,
    status: "draft",
    designId: ctx.design.id,
    designVersion: ctx.design.version,
    options,
    inclusions: [...DEFAULT_INCLUSIONS],
    exclusions: [...DEFAULT_EXCLUSIONS],
    assumptions: [...DEFAULT_PROPOSAL_ASSUMPTIONS],
    warranty: ctx.settings.warranty.manufacturerSummary?.trim() || null,
    guarantees: guaranteeLines(ctx.settings),
    validUntil: defaultValidUntil(ctx.settings, input.today),
    termsVersion: ctx.settings.legal.termsVersion,
    instantPriceGbp: input.instantPriceGbp,
    contractType: ctx.contractType,
    createdAt: input.now,
    draftRevision: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Gates                                                               */
/* ------------------------------------------------------------------ */

/**
 * Why this proposal can't be issued yet, in plain words for the builder
 * (empty when it can). The project's own gate (design signed, documents
 * consent, Schedule 2 details in settings) is checked by the reducer on
 * top of this; this is about the proposal record itself.
 */
/* ------------------------------------------------------------------ */
/* Planning and noise                                                  */
/* ------------------------------------------------------------------ */

/** The options whose design variant has a planning or noise check in review or blocked, with those checks. */
export function planningFlaggedOptions(
  p: Pick<ProposalRecord, "options">,
  design: Pick<DesignRecord, "variants"> | null | undefined,
): { label: string; designVariantId: string; flags: ReturnType<typeof planningNoiseFlags> }[] {
  return p.options
    .map((o) => ({ label: o.label.trim() || "An option", designVariantId: o.designVariantId, flags: planningNoiseFlags(design?.variants.find((v) => v.id === o.designVariantId)) }))
    .filter((o) => o.flags.length > 0);
}

/**
 * The short note the builder offers when a check is flagged, for the office
 * to edit: what the check found, in plain words, that a planning
 * application may be needed, and what happens next. It never says planning
 * is or isn't needed.
 */
export function defaultPlanningNote(flagged: ReturnType<typeof planningFlaggedOptions>, allOptions: number): string {
  const ids = new Set(flagged.flatMap((o) => o.flags.map((f) => f.id)));
  const found: string[] = [];
  if (ids.has("unit-count")) found.push("the number of outdoor units is more than permitted development allows for your home");
  if (ids.has("outdoor-volume")) found.push("the outdoor unit's size still has to be checked against the permitted development limit");
  if (ids.has("noise")) found.push("the noise at your neighbour's nearest window needs a closer look against the permitted development noise limit (MCS 020(a))");
  const which = flagged.length < allOptions ? `For the ${flagged.map((o) => o.label).join(" and ")} option${flagged.length === 1 ? "" : "s"}, our` : "Our";
  return `${which} design checks found that ${found.join(", and ") || "the planning checks need a closer look"}. A planning application, or a different position or unit, may be needed. Before any work starts we'll check it, with the council if needed, and tell you what it means for the dates and the price. Nothing is installed until it's settled.`;
}

/** Issue waits for one of the two: the customer told (a note on the proposal), or a recorded reason it doesn't apply. */
export function planningNoteErrors(
  p: Pick<ProposalRecord, "options" | "planningNote" | "planningNotApplicable">,
  design: Pick<DesignRecord, "variants"> | null | undefined,
): string[] {
  const flagged = planningFlaggedOptions(p, design);
  if (!flagged.length || p.planningNote?.trim() || p.planningNotApplicable?.reason.trim()) return [];
  return [
    `The design's planning or noise check is in review or blocked for ${flagged.map((o) => o.label).join(" and ")}: add the planning and noise note for the customer, or record why it doesn't apply.`,
  ];
}

/** The last day of the zero rate for energy-saving materials in homes (TAX_CODES["zero-esm"]): accountant to confirm. */
export const ZERO_ESM_LAST_DAY = "2027-03-31";

export function proposalIssueErrors(p: ProposalRecord, settings: PilotSettings, todayIso: string): string[] {
  const errors: string[] = [];
  const today = dateOf(todayIso);
  if (p.status !== "draft") errors.push("Only a draft can be issued. Revise it to make a new version.");
  if (p.options.length === 0) errors.push("Add at least one option.");

  const instantPence = Math.round((p.instantPriceGbp || 0) * 100);
  let anyAboveInstant = false;
  p.options.forEach((o) => {
    const name = o.label.trim() || "An option";
    if (!o.label.trim()) errors.push("Every option needs a name.");
    const pr = o.pricing;
    if (!pr || !(pr.netPence > 0) || !(pr.totalPence > 0)) {
      errors.push(`${name} isn't priced yet.`);
      return;
    }
    const lines = o.priceLines.reduce((a, l) => a + l.amountPence, 0);
    if (o.priceLines.length === 0 || lines !== pr.totalPence) errors.push(`${name}: the price breakdown doesn't add up to the total. Save it again to rebuild it.`);
    if (pr.pricingBasis === "manual" && !pr.manualReason?.trim()) errors.push(`${name}: a manual price needs a reason.`);
    if (pr.discount && !pr.discount.reason.trim()) errors.push(`${name}: the discount needs a reason.`);
    if (pr.pricingBasis === "engine" && p.contractType === "install-only") {
      errors.push(`${name}: the engine price includes the equipment. Use cost-plus or a manual price for an install-only contract.`);
    }
    if (!settings.tax.vatRegistered && (pr.taxCode !== "outside-scope" || pr.taxPence !== 0)) {
      errors.push(`${name}: we aren't VAT registered, so no VAT can be charged.`);
    }
    if (settings.tax.vatRegistered && pr.taxCode !== effectiveTaxCode(settings) && !p.taxOverride?.reason.trim()) {
      errors.push(`${name}: a different tax code from settings needs an admin override with a reason.`);
    }
    // The 0% rate for energy-saving materials (heat pumps in homes) ends on 31 March 2027: never offered after it.
    if (pr.taxCode === "zero-esm" && today > ZERO_ESM_LAST_DAY) {
      errors.push(`${name}: the 0% VAT rate for energy-saving materials ended on 31 March 2027. Use the standard rate (or the code your accountant gives you).`);
    }
    if (pr.belowMinMargin && !p.marginOverride?.reason.trim()) {
      errors.push(`${name}: the margin (${pr.grossMarginPct}%) is below the ${settings.pricing.minMarginPct}% minimum. Change the price, or an admin records an override with a reason.`);
    } else if ((pr.unpricedCostLines ?? 0) > 0 && !p.marginOverride?.reason.trim()) {
      // Fail closed: the margin on the priced lines alone overstates the real one.
      const n = pr.unpricedCostLines;
      errors.push(
        `${name}: ${n} cost line${n === 1 ? " has" : "s have"} no price, so the ${settings.pricing.minMarginPct}% minimum margin can't be checked. ${n === 1 ? "Type its cost in the build-up (or price it" : "Type their costs in the build-up (or price them"} in the catalogue), or an admin records an override with a reason.`,
      );
    }
    if (!(o.installDays >= 1)) errors.push(`${name}: set the install days.`);
    if (instantPence > 0 && pr.totalPence > instantPence) anyAboveInstant = true;
  });
  if (anyAboveInstant && !p.increaseReason?.trim()) {
    errors.push("The price is above the customer's online estimate, so say why (they'll see it on the proposal).");
  }

  if (!/^\d{4}-\d{2}-\d{2}/.test(p.validUntil ?? "")) errors.push("Set a valid-until date.");
  else if (dateOf(p.validUntil) <= today) errors.push("The valid-until date must be after today.");

  if (settings.tax.vatRegistered && !settings.tax.accountantConfirmed && !p.taxOverride?.reason.trim()) {
    errors.push("The VAT treatment isn't confirmed by the accountant yet: an admin records an override with a reason, or confirms it in settings.");
  }
  if (!p.termsVersion?.trim()) errors.push("Set the terms version (settings).");
  return errors;
}

/** At least two words with letters in them: a first name and a surname. */
export function isFullName(name: string): boolean {
  return name.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w)).length >= 2;
}

/**
 * Why this acceptance can't stand, in words for the customer (empty when it
 * can). The option and its total must match the proposal exactly; the name
 * is a full name; the cancellation information was acknowledged; and the
 * early-start answers are consistent with the contract type: only an
 * install-only (service) contract loses the right to cancel once fully
 * performed (CCR reg 36(2)), so only there is that acknowledged, and there
 * it must be when an early start is asked for.
 */
export function acceptanceErrors(p: ProposalRecord, a: Omit<AcceptanceRecord, "at">, todayIso: string): string[] {
  const errors: string[] = [];
  if (p.status !== "issued") {
    errors.push(p.status === "accepted" ? "This proposal has already been accepted." : "This proposal isn't open for acceptance.");
  } else if (isProposalExpired(p, todayIso)) {
    errors.push(`This proposal was valid until ${fmtDate(p.validUntil)}. Ask us and we'll send you an updated one.`);
  }
  const option = p.options.find((o) => o.id === a.optionId);
  if (!option) errors.push("Choose one of the options in your proposal.");
  else if (a.optionLabel !== option.label || a.totalPence !== option.pricing.totalPence) {
    errors.push("The option or price doesn't match your proposal. Please reload the page and try again.");
  }
  if (!isFullName(a.name ?? "")) errors.push("Type your full name: your first name and surname.");
  if (a.acknowledgedCancellationInfo !== true) errors.push("Confirm you've read your cancellation rights.");
  if (!a.termsVersion?.trim() || a.termsVersion !== p.termsVersion) errors.push("The terms have changed. Please reload the page and try again.");
  if (!a.cancellationNoticeVersion?.trim()) errors.push("The cancellation information is missing. Please reload the page.");
  const installOnly = (p.contractType ?? "supply-and-install") === "install-only";
  if (a.acknowledgedLossOfRight && !(installOnly && a.earlyStartRequested)) {
    errors.push("Losing the right to cancel only applies when you ask us to start early on an installation-only contract.");
  }
  if (installOnly && a.earlyStartRequested && !a.acknowledgedLossOfRight) {
    errors.push("To start early, confirm you understand you lose the right to cancel once the work is fully completed.");
  }
  return errors;
}

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * A new draft version copying the options and wording. Never touches the
 * original (accepted or not): marking that superseded happens when the new
 * version is issued. The new draft starts without the old one's issue,
 * view, acceptance, decision and overrides: an override was for the old
 * price, so it's made again if still needed.
 */
export function reviseProposal(p: ProposalRecord, newId: string, now: string): ProposalRecord {
  const src = clone(p);
  const {
    issuedAt: _issuedAt,
    issuedBy: _issuedBy,
    viewedAt: _viewedAt,
    acceptance: _acceptance,
    declinedReason: _declined,
    changeRequest: _change,
    supersededBy: _superseded,
    marginOverride: _margin,
    taxOverride: _tax,
    ...rest
  } = src;
  return {
    ...rest,
    options: rest.options.map((o) => ({ ...o, pricingInputs: pricingInputsOf(o) })),
    id: newId,
    version: p.version + 1,
    status: "draft",
    createdAt: now,
    draftRevision: 0,
  };
}

/**
 * The inputs an option was priced with: stored ones, or (for records made
 * before inputs were kept) the nearest equivalent read back from its
 * pricing, so a revision reprices to the same figures rather than jumping
 * to another basis.
 */
export function pricingInputsOf(o: Pick<ProposalOption, "pricing" | "pricingInputs">): PricingInputs {
  if (o.pricingInputs) return clone(o.pricingInputs);
  const pr = o.pricing;
  const out: PricingInputs = { basis: pr.pricingBasis };
  if (pr.pricingBasis === "manual") {
    out.manualNetPence = pr.listNetPence;
    if (pr.manualReason) out.manualReason = pr.manualReason;
  }
  if (pr.pricingBasis === "cost-plus" && pr.listNetPence > 0 && pr.costPence > 0) {
    // The margin the list price gives on these costs, rounded down so the price doesn't creep up.
    out.targetMarginPct = Math.max(0, Math.floor(((pr.listNetPence - pr.costPence) / pr.listNetPence) * 100));
  }
  if (pr.discount) {
    out.discountCode = pr.discount.code === "CUSTOM" ? undefined : pr.discount.code;
    out.discountReason = pr.discount.reason;
    if (pr.discount.code === "CUSTOM" || pr.discount.code.toUpperCase() === "PILOTCUSTOM") out.customDiscountPence = pr.discount.amountPence;
    if (out.discountCode === undefined) delete out.discountCode;
  }
  return out;
}

/**
 * Price lines with any discount line folded into the others, so they still
 * add up to the total the customer pays and no "was" price can be read off
 * them. The fee lines (VAT) stay as they are; the rest are scaled to the
 * net, the last taking the rounding.
 */
export function withoutDiscountLine(lines: PriceLine[], netPence: number): PriceLine[] {
  if (!lines.some((l) => l.kind === "discount")) return lines.map((l) => ({ ...l }));
  const kept = lines.filter((l) => l.kind !== "discount");
  const base = kept.filter((l) => l.kind !== "fee");
  const gross = base.reduce((a, l) => a + l.amountPence, 0);
  if (base.length === 0 || gross <= 0) return kept.map((l) => ({ ...l }));
  let left = netPence;
  const last = kept.indexOf(base[base.length - 1]!);
  return kept.map((l, i) => {
    if (l.kind === "fee") return { ...l };
    const amount = i === last ? left : Math.round((netPence * l.amountPence) / gross);
    left -= amount;
    return { ...l, amountPence: amount };
  });
}

/**
 * What customers may see: no cost lines, margins, costs, pricing inputs,
 * overrides or internal notes, and no list price or discount amount (the
 * customer sees their pilot price, never a "was £X"). The labour plan keeps
 * only the crew size.
 */
export function customerSafeProposal(p: ProposalRecord): ProposalRecord {
  const { marginOverride: _m, taxOverride: _t, internalNotes: _n, draftRevision: _r, planningNotApplicable: _pn, ...rest } = clone(p);
  return {
    ...rest,
    options: rest.options.map(({ pricingInputs: _inputs, ...o }) => {
      const { manualReason: _reason, discount: _discount, ...pricing } = o.pricing;
      return {
        ...o,
        costLines: [],
        labour: { crewSize: o.labour.crewSize, installerDays: 0, electricianDays: 0, techLeadDays: 0 },
        priceLines: withoutDiscountLine(o.priceLines, pricing.netPence),
        pricing: {
          ...pricing,
          listNetPence: pricing.netPence,
          costPence: 0,
          unpricedCostLines: 0,
          grossMarginPct: 0,
          grossMarginPctBeforeDiscount: 0,
          contributionPence: 0,
          belowMinMargin: false,
        },
      };
    }),
  };
}

/**
 * The content a customer accepts: the customer-safe proposal without its
 * changing status fields (status, viewed, decision, acceptance), so the
 * hash of what they saw is the same before and after they act on it.
 */
export function proposalDocumentContent(p: ProposalRecord): Omit<ProposalRecord, "status" | "viewedAt" | "acceptance" | "declinedReason" | "changeRequest" | "supersededBy"> {
  const {
    status: _s,
    viewedAt: _v,
    acceptance: _a,
    declinedReason: _d,
    changeRequest: _c,
    supersededBy: _x,
    ...content
  } = customerSafeProposal(p);
  return content;
}

/** Was any discount given on this proposal's options? (Internal record only: the customer view drops it.) */
export function hasPilotDiscount(p: ProposalRecord): boolean {
  return p.options.some((o) => (o.pricing.discount?.amountPence ?? 0) > 0);
}
