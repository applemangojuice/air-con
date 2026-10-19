import type { CostCategory, CostLine } from "./costing.ts";
import type { Issue, IssueKind } from "./issues.ts";
import { creditPurposeOf, type Invoice } from "./money.ts";
import { PROJECT_STAGES, currentStage, daysBetween, type Project, type ProjectStageId } from "./project.ts";
import type { ProposalOption, ProposalRecord } from "./proposal.ts";
import type { PoLine, PurchaseOrder } from "./purchasing.ts";
import { TAX_CODES, type PilotSettings } from "./settings.ts";
import type { StaffRole } from "./staff.ts";
import { diffAccuracyPct, type SelfSurveyDiffRow } from "./survey-visit.ts";

/**
 * The pilot learning loop: time, cost, learnings and the numbers that say
 * whether Pilot 2 went better than Pilot 1.
 *
 * Metrics are a pure function of the records (project, proposal, POs, time
 * log, issues), so the dashboard and the CSV always agree, and nothing is
 * typed in twice. Honest by construction: a number nobody recorded is
 * `null` (or 0 for counts of things that would have left a record), never
 * a guess, and expected costs standing in for actual ones are flagged
 * (`costBasis`).
 */

export interface TimeEntry {
  id: string;
  projectId: string;
  staffId?: string;
  staffName: string;
  kind: "survey" | "design" | "proposal" | "travel" | "install" | "rework" | "commissioning" | "handover" | "admin";
  dayN?: number;
  startedAt: string;
  endedAt?: string;
  minutes?: number;
  note?: string;
}

export const TIME_KINDS: TimeEntry["kind"][] = [
  "survey",
  "design",
  "proposal",
  "travel",
  "install",
  "rework",
  "commissioning",
  "handover",
  "admin",
];

export const TIME_KIND_LABEL: Record<TimeEntry["kind"], string> = {
  survey: "Survey",
  design: "Design",
  proposal: "Proposal",
  travel: "Travel",
  install: "Install",
  rework: "Rework",
  commissioning: "Commissioning",
  handover: "Handover",
  admin: "Admin",
};

/** Asked at End day, about two minutes. Ids are stable: answers key on them. */
export const LEARNING_PROMPTS: { id: string; question: string }[] = [
  { id: "took-longer", question: "What took longer than expected?" },
  { id: "missing", question: "What was missing?" },
  { id: "tool", question: "What tool would have saved time?" },
  { id: "survey-gap", question: "What should the survey have captured?" },
  { id: "revisit", question: "What could have avoided a revisit?" },
  { id: "customer-confused", question: "What confused the customer?" },
  { id: "asked-office", question: "What did you have to ask the office?" },
  { id: "unclear-step", question: "Which checklist step was unclear?" },
];

export interface Learning {
  id: string;
  projectId: string;
  dayN?: number;
  stage?: ProjectStageId;
  author: { staffId?: string; name: string };
  answers: { promptId: string; answer: string }[];
  tags: string[];
  status: "open" | "applied" | "wont-fix";
  appliedNote?: string;
  createdAt: string;
}

export const LEARNING_STATUS_LABEL: Record<Learning["status"], string> = {
  open: "Open",
  applied: "Applied",
  "wont-fix": "Won't fix",
};

export interface PilotMetrics {
  projectId: string;
  pilotNumber?: number;
  label: string;
  stage: ProjectStageId;
  instantPricePence: number;
  listPricePence: number | null;
  contractPricePence: number | null;
  revenuePence: number;
  equipmentCostPence: number;
  materialsCostPence: number;
  subcontractCostPence: number;
  estimatedCostPence: number | null;
  actualCostPence: number;
  grossProfitPence: number | null;
  grossMarginPct: number | null;
  estimatedLabourHours: number | null;
  actualLabourHours: number;
  labourHoursByPerson: Record<string, number>;
  labourHoursByKind: Record<string, number>;
  travelHours: number;
  reworkHours: number;
  plannedInstallDays: number;
  actualInstallDays: number | null;
  surveyMinutes: number | null;
  daysQuoteToSurvey: number | null;
  daysSurveyToProposal: number | null;
  daysAcceptanceToInstall: number | null;
  issuesByKind: Record<string, number>;
  unplannedMaterials: number;
  customerChanges: number;
  messagesSent: number;
  satisfaction: number | null;
  defects7d: number;
  defects30d: number;
  selfSurveyAccuracyPct: number | null;
  /*
   * Additions beyond the contract (§D4), so the dashboard can say how far
   * to trust the money rows.
   */
  /**
   * Where the equipment and materials figures come from: every purchase
   * order line at its actual cost, some at the expected cost (mixed), all
   * expected, a required line with no cost at all (incomplete: the figures
   * leave it out, so gross profit and margin are unknown), or no purchase
   * orders yet (none: nothing bought is known, so neither are they).
   */
  costBasis: "actual" | "mixed" | "expected" | "incomplete" | "none";
  /** Required order lines with neither an expected nor an actual cost: what makes the basis incomplete. */
  unknownCostLines: number;
  /** Logged hours costed at the settings' labour rates; null when no rates were given. */
  labourCostPence: number | null;
  /** Hours the install estimate covers: install, commissioning, handover and rework. */
  installLabourHours: number;
  /**
   * VAT on supplier costs we can't reclaim (not VAT registered): 20% on
   * every order line, delivery and subcontract cost that isn't already a
   * VAT-inclusive price, exactly as the estimate's "input-vat" line. Part of
   * the actual cost. 0 when registered (or the settings don't say).
   */
  inputVatPence: number;
  /** Money taken off the price after the contract (credit notes for a reduction: goodwill, a snag), net of VAT. Already out of revenue. */
  reductionsPence: number;
}

/** The input VAT the estimate adds on supplier costs while we aren't registered (costing's INPUT_VAT_PCT). */
const INPUT_VAT_PCT = 20;

/** Labour estimates are in person-days; a day is this many hours. */
export const HOURS_PER_DAY = 8;

/** Issue kinds that count as a defect after handover. */
const DEFECT_KINDS: ReadonlySet<IssueKind> = new Set<IssueKind>(["defect", "snag", "fault"]);
/** Time kinds the install labour estimate (installer, electrician and tech-lead days) covers. */
const INSTALL_KINDS: ReadonlySet<TimeEntry["kind"]> = new Set<TimeEntry["kind"]>(["install", "commissioning", "handover", "rework"]);

const round1 = (n: number) => Math.round(n * 10) / 10;
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const dateOf = (iso: string) => iso.slice(0, 10);

/** An entry's length in minutes: as logged, else from its start and end. A running clock counts nothing yet. */
export function entryMinutes(entry: Pick<TimeEntry, "minutes" | "startedAt" | "endedAt">): number {
  if (typeof entry.minutes === "number" && Number.isFinite(entry.minutes)) return Math.max(0, entry.minutes);
  if (!entry.endedAt) return 0;
  const ms = Date.parse(entry.endedAt) - Date.parse(entry.startedAt);
  return Number.isFinite(ms) && ms > 0 ? ms / 60_000 : 0;
}

/** The option the numbers are about: the accepted one, else the one named on the project, else the first. */
export function chosenOption(proposal: ProposalRecord | undefined, project: Project): ProposalOption | undefined {
  if (!proposal || !Array.isArray(proposal.options) || proposal.options.length === 0) return undefined;
  const byAcceptance = proposal.acceptance && proposal.options.find((o) => o.id === proposal.acceptance!.optionId);
  if (byAcceptance) return byAcceptance;
  const label = project.proposal.acceptedOptionLabel;
  const byLabel = label ? proposal.options.find((o) => o.label === label) : undefined;
  return byLabel ?? proposal.options[0];
}

/**
 * A PO line's cost: actual when someone recorded it (always ex VAT), else
 * expected (a VAT-inclusive catalogue price when the line says so), else
 * unknown (never £0). `gross`: the figure already includes VAT.
 */
function lineCost(line: PoLine): { pence: number; actual: boolean; known: boolean; gross: boolean } {
  if (typeof line.actualUnitCostPence === "number") return { pence: Math.round(line.actualUnitCostPence * line.qty), actual: true, known: true, gross: false };
  if (typeof line.unitCostPence === "number") return { pence: Math.round(line.unitCostPence * line.qty), actual: false, known: true, gross: line.vatIncluded === true };
  return { pence: 0, actual: false, known: false, gross: false };
}

/** The hourly rate for one entry: surveys at the surveyor rate, the rest by the person's trade. */
function hourlyRatePence(entry: TimeEntry, roles: StaffRole[] | undefined, rates: PilotSettings["pricing"]["labourRates"]): number {
  if (entry.kind === "survey") return rates.surveyorHourPence;
  const r = roles ?? [];
  if (r.includes("electrician") && !r.includes("installer")) return rates.electricianDayPence / HOURS_PER_DAY;
  if (r.includes("tech-lead") || r.includes("admin")) return rates.techLeadDayPence / HOURS_PER_DAY;
  return rates.installerDayPence / HOURS_PER_DAY;
}

/** Days from one instant to another by calendar date, or null when either is missing. */
function daysFromTo(from: string | undefined, to: string | undefined): number | null {
  if (!from || !to || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) return null;
  return daysBetween(from, to);
}

const firstEventAt = (p: Project, types: string[]) => p.events.find((e) => types.includes(e.type))?.at;

/**
 * One pilot's numbers. Optional inputs beyond the contract: `settings` (to
 * cost the logged hours at the labour rates), `staffRoles` (whose rate
 * applies, by staff id) and `surveyMinutes` (the survey record's own
 * timing, preferred when present).
 */
export function pilotMetrics(input: {
  project: Project;
  proposal?: ProposalRecord;
  purchaseOrders: PurchaseOrder[];
  time: TimeEntry[];
  issues: Issue[];
  messagesSent: number;
  surveyDiff?: SelfSurveyDiffRow[];
  /** `tax` says whether supplier VAT is a cost (not registered) or reclaimed (registered). */
  settings?: Pick<PilotSettings, "pricing"> & Partial<Pick<PilotSettings, "tax">>;
  staffRoles?: Record<string, StaffRole[]>;
  surveyMinutes?: number;
  /** The project's invoices: price-reduction credit notes come off revenue. */
  invoices?: Invoice[];
}): PilotMetrics {
  const { project: p, proposal } = input;
  const option = chosenOption(proposal, p);
  const pricing = option?.pricing;

  // Prices. The instant price is the funnel's VAT-inclusive total; the list
  // price is the option's pre-discount price with that option's tax on top,
  // so the three compare like for like with the contract total.
  const instantPricePence = Math.round((p.quoteSummary.totalGbp || 0) * 100);
  let listPricePence: number | null = null;
  if (pricing && Number.isFinite(pricing.listNetPence)) {
    const rate = TAX_CODES[pricing.taxCode]?.ratePct ?? 0;
    listPricePence = Math.round(pricing.listNetPence * (1 + rate / 100));
  }
  const accepted = p.proposal.status === "accepted";
  const contractPricePence = accepted ? (p.proposal.contractTotalPence ?? p.money.contractTotalPence ?? null) : null;

  // Revenue is net of VAT (VAT isn't ours): the accepted option's net price,
  // plus accepted variations and date-change fees, less money taken off the
  // price since (reduction credit notes). Nothing until a contract.
  const issues = input.issues ?? [];
  const variationsNet = sum(
    issues.filter((i) => i.kind === "variation" && i.variation?.status === "accepted").map((i) => i.variation!.priceDeltaNetPence || 0),
  );
  // Money off the price afterwards (a reduction credit note: goodwill, a snag) is
  // revenue given up; a correction only fixes an invoicing slip, so it isn't.
  const reductionsPence = -sum(
    (input.invoices ?? [])
      .filter((i) => i.status !== "void" && i.status !== "draft" && i.kind === "credit-note" && creditPurposeOf(i) === "reduction")
      .map((i) => i.netPence || 0),
  );
  let revenuePence = 0;
  if (contractPricePence !== null) {
    const base = pricing && accepted ? pricing.netPence : contractPricePence;
    revenuePence = base + variationsNet + (p.money.changeFeesPence || 0) - reductionsPence;
  }

  // Costs: purchase orders by the category the design's cost lines gave each
  // catalogue item (unmatched lines count as materials); actual where
  // recorded, else expected.
  const categoryByItem = new Map<string, CostCategory>();
  for (const line of option?.costLines ?? []) {
    if (line.catalogueItemId) categoryByItem.set(line.catalogueItemId, line.category);
  }
  // VAT, as the estimate treats it (buildCostLines): registered, every cost is
  // ex VAT (a VAT-inclusive catalogue price is taken back to net); not
  // registered, the VAT we pay suppliers is a cost (input VAT on every figure
  // that doesn't already include it). Without tax settings, figures as recorded.
  const registered = input.settings?.tax ? input.settings.tax.vatRegistered : undefined;
  const vatOn = (pence: number, gross: boolean): number => (registered === false && !gross ? Math.round((pence * INPUT_VAT_PCT) / 100) : 0);
  const asCost = (pence: number, gross: boolean): number => (registered === true && gross ? Math.round(pence / (1 + INPUT_VAT_PCT / 100)) : pence);
  let equipment = 0;
  let materials = 0;
  let subcontractFromPos = 0;
  let shipping = 0;
  let inputVat = 0;
  let subcontractVatFromPos = 0;
  let actualLines = 0;
  let expectedLines = 0;
  let unknownLines = 0;
  for (const po of input.purchaseOrders ?? []) {
    if (po.status === "cancelled") continue;
    shipping += po.shippingPence || 0;
    inputVat += vatOn(po.shippingPence || 0, false);
    for (const line of po.lines ?? []) {
      const c = lineCost(line);
      if (!c.known) {
        // Never £0: a required line nobody priced makes the cost unknown.
        // (Van stock with no price is left out: it's the van's, not the job's.)
        if (line.required) unknownLines++;
        continue;
      }
      if (c.actual) actualLines++;
      else expectedLines++;
      const cost = asCost(c.pence, c.gross);
      const category = (line.catalogueItemId && categoryByItem.get(line.catalogueItemId)) || "materials";
      if (category === "equipment") equipment += cost;
      else if (category === "subcontract") {
        subcontractFromPos += cost;
        subcontractVatFromPos += vatOn(c.pence, c.gross);
        continue;
      } else materials += cost;
      inputVat += vatOn(c.pence, c.gross);
    }
  }
  const costBasis: PilotMetrics["costBasis"] =
    unknownLines > 0
      ? "incomplete"
      : actualLines + expectedLines === 0
        ? "none"
        : expectedLines === 0
          ? "actual"
          : actualLines === 0
            ? "expected"
            : "mixed";

  // Subcontract work isn't bought on a PO: the proposal's expected figure
  // stands in until one is raised.
  const subcontractLines = (option?.costLines ?? []).filter((l: CostLine) => l.category === "subcontract");
  const expectedSubcontract = sum(subcontractLines.map((l) => asCost(l.totalPence ?? 0, l.vatIncluded === true)));
  const subcontractCostPence = subcontractFromPos > 0 ? subcontractFromPos : expectedSubcontract;
  inputVat += subcontractFromPos > 0 ? subcontractVatFromPos : sum(subcontractLines.map((l) => vatOn(l.totalPence ?? 0, l.vatIncluded === true)));

  // Time.
  const time = input.time ?? [];
  const byPerson: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let totalMinutes = 0;
  let installMinutes = 0;
  let labourCost = 0;
  const rates = input.settings?.pricing.labourRates;
  for (const entry of time) {
    const minutes = entryMinutes(entry);
    if (minutes <= 0) continue;
    totalMinutes += minutes;
    if (INSTALL_KINDS.has(entry.kind)) installMinutes += minutes;
    const who = entry.staffName?.trim() || "Unnamed";
    byPerson[who] = (byPerson[who] ?? 0) + minutes;
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + minutes;
    if (rates) labourCost += (minutes / 60) * hourlyRatePence(entry, entry.staffId ? input.staffRoles?.[entry.staffId] : undefined, rates);
  }
  const hours = (m: number) => round1(m / 60);
  const labourHoursByPerson = Object.fromEntries(Object.entries(byPerson).map(([k, v]) => [k, hours(v)]));
  const labourHoursByKind = Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, hours(v)]));
  const labourCostPence = rates ? Math.round(labourCost) : null;

  const actualCostPence = equipment + materials + subcontractCostPence + shipping + inputVat + (labourCostPence ?? 0);
  const estimatedCostPence = pricing && Number.isFinite(pricing.costPence) ? pricing.costPence : null;
  // Profit only on a cost we know: with a required line unpriced, or nothing
  // ordered at all, the kit's cost is missing, not £0.
  const costsKnown = costBasis !== "incomplete" && costBasis !== "none";
  const grossProfitPence = contractPricePence !== null && revenuePence > 0 && costsKnown ? revenuePence - actualCostPence : null;
  const grossMarginPct = grossProfitPence !== null ? round1((grossProfitPence / revenuePence) * 100) : null;

  // Person-days, as the costing prices them (buildCostLines): installer days
  // are per installer, so the crew multiplies them; every crew member logs
  // their own time.
  const labour = option?.labour;
  const estimatedLabourHours = labour
    ? round1(
        (Math.max(0, labour.crewSize) * Math.max(0, labour.installerDays) + Math.max(0, labour.electricianDays) + Math.max(0, labour.techLeadDays)) *
          HOURS_PER_DAY,
      )
    : null;

  // Install days: the days actually started, once the install has begun.
  const worked = p.install.days.filter((d) => d.status !== "planned" || d.startedAt);
  const actualInstallDays = p.install.status === "not-started" && worked.length === 0 ? null : worked.length;
  const plannedInstallDays = option?.installDays || p.booking.installDays || p.quoteSummary.installDays;

  // Survey length: the record's own timing, else the logged survey time,
  // else start to submit on the day (only when it's a plausible visit).
  let surveyMinutes: number | null = typeof input.surveyMinutes === "number" && input.surveyMinutes > 0 ? Math.round(input.surveyMinutes) : null;
  if (surveyMinutes === null && byKind.survey) surveyMinutes = Math.round(byKind.survey);
  if (surveyMinutes === null && p.survey.startedAt && p.survey.submittedAt) {
    const span = (Date.parse(p.survey.submittedAt) - Date.parse(p.survey.startedAt)) / 60_000;
    if (Number.isFinite(span) && span > 0 && span <= 12 * 60) surveyMinutes = Math.round(span);
  }

  // Durations.
  const surveyedAt = p.survey.status === "submitted" ? (p.survey.submittedAt ?? p.survey.scheduledFor) : undefined;
  const firstIssue = firstEventAt(p, ["proposal-issued"]) ?? p.proposal.issuedAt;
  const installStart = p.install.startedAt ?? p.install.days.find((d) => d.startedAt)?.startedAt;
  const daysQuoteToSurvey = daysFromTo(p.createdAt, surveyedAt);
  const daysSurveyToProposal = surveyedAt ? daysFromTo(surveyedAt, firstIssue) : null;
  const daysAcceptanceToInstall = daysFromTo(p.proposal.acceptedAt, installStart);

  // Issues.
  const issuesByKind: Record<string, number> = {};
  for (const issue of issues) issuesByKind[issue.kind] = (issuesByKind[issue.kind] ?? 0) + 1;
  const handedOn = p.handover.handedOverAt ? dateOf(p.handover.handedOverAt) : null;
  const defectsWithin = (days: number) =>
    handedOn
      ? issues.filter((i) => {
          if (!DEFECT_KINDS.has(i.kind) || !i.raisedAt) return false;
          const d = daysBetween(handedOn, i.raisedAt);
          return d >= 0 && d <= days;
        }).length
      : 0;

  // Lines nobody planned: not on the design's bill of materials. Van-stock
  // consumables are on the bill (purchasing marks them not required, since the
  // van carries them), so they don't count.
  const unplannedMaterials = sum(
    (input.purchaseOrders ?? [])
      .filter((po) => po.status !== "cancelled")
      .map((po) => (po.lines ?? []).filter((l) => !l.required && l.category !== "consumables").length),
  );
  const customerChanges =
    p.events.filter((e) => e.type === "proposal-changes-requested").length +
    issues.filter((i) => i.kind === "variation" || i.kind === "customer-instruction").length;

  // The same score the command centre's self-survey diff shows (F2's diffAccuracyPct).
  const selfSurveyAccuracyPct = diffAccuracyPct(input.surveyDiff ?? []);

  return {
    projectId: p.id,
    ...(p.pilot ? { pilotNumber: p.pilot.number } : {}),
    label: p.pilot?.label || p.customer.name || p.id,
    stage: currentStage(p),
    instantPricePence,
    listPricePence,
    contractPricePence,
    revenuePence,
    equipmentCostPence: equipment,
    materialsCostPence: materials + shipping,
    subcontractCostPence,
    estimatedCostPence,
    actualCostPence,
    grossProfitPence,
    grossMarginPct,
    estimatedLabourHours,
    actualLabourHours: hours(totalMinutes),
    labourHoursByPerson,
    labourHoursByKind,
    travelHours: hours(byKind.travel ?? 0),
    reworkHours: hours(byKind.rework ?? 0),
    plannedInstallDays,
    actualInstallDays,
    surveyMinutes,
    daysQuoteToSurvey,
    daysSurveyToProposal,
    daysAcceptanceToInstall,
    issuesByKind,
    unplannedMaterials,
    customerChanges,
    messagesSent: Math.max(0, Math.round(input.messagesSent || 0)),
    satisfaction: p.aftercare.feedback ? p.aftercare.feedback.score : null,
    defects7d: defectsWithin(7),
    defects30d: defectsWithin(30),
    selfSurveyAccuracyPct,
    costBasis,
    unknownCostLines: unknownLines,
    labourCostPence,
    installLabourHours: hours(installMinutes),
    inputVatPence: inputVat,
    reductionsPence,
  };
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */

export type MetricFormat = "money" | "pct" | "hours" | "days" | "minutes" | "count" | "score" | "text";

export interface MetricRow {
  key: keyof PilotMetrics;
  label: string;
  format: MetricFormat;
  /** Which way is better, for highlighting; null when neither is (prices). */
  better: "higher" | "lower" | null;
  group: "Price" | "Money" | "Labour" | "Timing" | "Quality";
  /**
   * The stage a pilot must have reached for this number to be final enough
   * to call best or worst (a pilot that hasn't been installed yet hasn't
   * "spent least on equipment"). Shown either way; only compared from here.
   */
  from?: ProjectStageId;
}

/** The comparison table, top to bottom. Record fields are shown as breakdowns, not compared. */
export const PILOT_METRIC_ROWS: MetricRow[] = [
  { key: "instantPricePence", label: "Instant price", format: "money", better: null, group: "Price" },
  { key: "listPricePence", label: "List price", format: "money", better: null, group: "Price" },
  { key: "contractPricePence", label: "Contract price", format: "money", better: null, group: "Price" },
  { key: "revenuePence", label: "Revenue (net, after credits)", format: "money", better: "higher", group: "Money", from: "handover" },
  { key: "equipmentCostPence", label: "Equipment cost", format: "money", better: "lower", group: "Money", from: "handover" },
  { key: "materialsCostPence", label: "Materials and delivery", format: "money", better: "lower", group: "Money", from: "handover" },
  { key: "subcontractCostPence", label: "Subcontract", format: "money", better: "lower", group: "Money", from: "handover" },
  { key: "labourCostPence", label: "Labour (logged hours at rates)", format: "money", better: "lower", group: "Money", from: "handover" },
  { key: "inputVatPence", label: "VAT we can't reclaim", format: "money", better: "lower", group: "Money", from: "handover" },
  { key: "estimatedCostPence", label: "Estimated cost", format: "money", better: null, group: "Money" },
  { key: "actualCostPence", label: "Cost so far", format: "money", better: "lower", group: "Money", from: "handover" },
  { key: "grossProfitPence", label: "Gross profit", format: "money", better: "higher", group: "Money", from: "handover" },
  { key: "grossMarginPct", label: "Gross margin", format: "pct", better: "higher", group: "Money", from: "handover" },
  { key: "estimatedLabourHours", label: "Install labour, estimated", format: "hours", better: null, group: "Labour" },
  { key: "installLabourHours", label: "Install labour, logged", format: "hours", better: "lower", group: "Labour", from: "handover" },
  { key: "actualLabourHours", label: "All logged hours", format: "hours", better: "lower", group: "Labour", from: "handover" },
  { key: "travelHours", label: "Travel", format: "hours", better: "lower", group: "Labour", from: "handover" },
  { key: "reworkHours", label: "Rework", format: "hours", better: "lower", group: "Labour", from: "handover" },
  { key: "plannedInstallDays", label: "Install days planned", format: "days", better: null, group: "Timing" },
  { key: "actualInstallDays", label: "Install days worked", format: "days", better: "lower", group: "Timing", from: "handover" },
  { key: "surveyMinutes", label: "Survey length", format: "minutes", better: "lower", group: "Timing", from: "proposal" },
  { key: "daysQuoteToSurvey", label: "Quote to survey", format: "days", better: "lower", group: "Timing", from: "proposal" },
  { key: "daysSurveyToProposal", label: "Survey to proposal", format: "days", better: "lower", group: "Timing" },
  { key: "daysAcceptanceToInstall", label: "Acceptance to install", format: "days", better: "lower", group: "Timing" },
  { key: "unplannedMaterials", label: "Unplanned material lines", format: "count", better: "lower", group: "Quality", from: "handover" },
  { key: "customerChanges", label: "Customer changes", format: "count", better: "lower", group: "Quality", from: "handover" },
  { key: "messagesSent", label: "Messages sent", format: "count", better: null, group: "Quality" },
  { key: "satisfaction", label: "Satisfaction (0 to 10)", format: "score", better: "higher", group: "Quality" },
  { key: "defects7d", label: "Defects within 7 days", format: "count", better: "lower", group: "Quality", from: "aftercare" },
  { key: "defects30d", label: "Defects within 30 days", format: "count", better: "lower", group: "Quality", from: "aftercare" },
  { key: "selfSurveyAccuracyPct", label: "Self-survey accuracy", format: "pct", better: "higher", group: "Quality" },
];

/** Has this pilot reached the point where the row's number can be compared? */
export function metricComparable(row: Pick<MetricRow, "from">, m: Pick<PilotMetrics, "stage">): boolean {
  if (!row.from) return true;
  return PROJECT_STAGES.indexOf(m.stage) >= PROJECT_STAGES.indexOf(row.from);
}

/** One row's best and worst columns, among the pilots far enough along to compare. */
export function rowExtremes(row: MetricRow, metrics: PilotMetrics[]): { best: number[]; worst: number[] } {
  return extremes(
    metrics.map((m) => (metricComparable(row, m) ? (m[row.key] as number | null | undefined) : null)),
    row.better,
  );
}

/**
 * Which columns are best and worst on one row. Only real numbers compete;
 * with fewer than two of them, or when they're all equal, nothing is
 * highlighted (a lone pilot isn't "best" at anything).
 */
export function extremes(values: (number | null | undefined)[], better: "higher" | "lower" | null): { best: number[]; worst: number[] } {
  const none = { best: [] as number[], worst: [] as number[] };
  if (!better) return none;
  const real = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => typeof x.v === "number" && Number.isFinite(x.v));
  if (real.length < 2) return none;
  const max = Math.max(...real.map((x) => x.v));
  const min = Math.min(...real.map((x) => x.v));
  if (max === min) return none;
  const hi = real.filter((x) => x.v === max).map((x) => x.i);
  const lo = real.filter((x) => x.v === min).map((x) => x.i);
  return better === "higher" ? { best: hi, worst: lo } : { best: lo, worst: hi };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

type Column = { header: string; value: (m: PilotMetrics) => string | number | null | undefined };

const pounds = (pence: number | null) => (pence === null ? null : (pence / 100).toFixed(2));
const breakdown = (r: Record<string, number>) =>
  Object.entries(r)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");

const CSV_COLUMNS: Column[] = [
  { header: "pilot_number", value: (m) => m.pilotNumber },
  { header: "label", value: (m) => m.label },
  { header: "project_id", value: (m) => m.projectId },
  { header: "stage", value: (m) => m.stage },
  { header: "instant_price_gbp", value: (m) => pounds(m.instantPricePence) },
  { header: "list_price_gbp", value: (m) => pounds(m.listPricePence) },
  { header: "contract_price_gbp", value: (m) => pounds(m.contractPricePence) },
  { header: "revenue_net_gbp", value: (m) => pounds(m.revenuePence) },
  { header: "equipment_cost_gbp", value: (m) => pounds(m.equipmentCostPence) },
  { header: "materials_cost_gbp", value: (m) => pounds(m.materialsCostPence) },
  { header: "subcontract_cost_gbp", value: (m) => pounds(m.subcontractCostPence) },
  { header: "labour_cost_gbp", value: (m) => pounds(m.labourCostPence) },
  { header: "unreclaimable_vat_gbp", value: (m) => pounds(m.inputVatPence) },
  { header: "price_reductions_net_gbp", value: (m) => pounds(m.reductionsPence) },
  { header: "cost_basis", value: (m) => m.costBasis },
  { header: "order_lines_without_cost", value: (m) => m.unknownCostLines },
  { header: "estimated_cost_gbp", value: (m) => pounds(m.estimatedCostPence) },
  { header: "actual_cost_gbp", value: (m) => pounds(m.actualCostPence) },
  { header: "gross_profit_gbp", value: (m) => pounds(m.grossProfitPence) },
  { header: "gross_margin_pct", value: (m) => m.grossMarginPct },
  { header: "estimated_install_labour_hours", value: (m) => m.estimatedLabourHours },
  { header: "logged_install_labour_hours", value: (m) => m.installLabourHours },
  { header: "logged_hours_total", value: (m) => m.actualLabourHours },
  { header: "hours_by_person", value: (m) => breakdown(m.labourHoursByPerson) },
  { header: "hours_by_kind", value: (m) => breakdown(m.labourHoursByKind) },
  { header: "travel_hours", value: (m) => m.travelHours },
  { header: "rework_hours", value: (m) => m.reworkHours },
  { header: "install_days_planned", value: (m) => m.plannedInstallDays },
  { header: "install_days_worked", value: (m) => m.actualInstallDays },
  { header: "survey_minutes", value: (m) => m.surveyMinutes },
  { header: "days_quote_to_survey", value: (m) => m.daysQuoteToSurvey },
  { header: "days_survey_to_proposal", value: (m) => m.daysSurveyToProposal },
  { header: "days_acceptance_to_install", value: (m) => m.daysAcceptanceToInstall },
  { header: "issues_by_kind", value: (m) => breakdown(m.issuesByKind) },
  { header: "unplanned_material_lines", value: (m) => m.unplannedMaterials },
  { header: "customer_changes", value: (m) => m.customerChanges },
  { header: "messages_sent", value: (m) => m.messagesSent },
  { header: "satisfaction_0_10", value: (m) => m.satisfaction },
  { header: "defects_7d", value: (m) => m.defects7d },
  { header: "defects_30d", value: (m) => m.defects30d },
  { header: "self_survey_accuracy_pct", value: (m) => m.selfSurveyAccuracyPct },
];

/**
 * One CSV cell: quoted when it holds a comma, quote or line break, and
 * defused when a spreadsheet would read it as a formula (a label typed in
 * ops could start with "=").
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Every pilot, one row each, money in pounds, unknowns as empty cells. CRLF line ends (RFC 4180). */
export function pilotsCsv(rows: PilotMetrics[]): string {
  const header = CSV_COLUMNS.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((m) => CSV_COLUMNS.map((c) => csvCell(c.value(m))).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}
