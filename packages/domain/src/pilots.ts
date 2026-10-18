import type { Issue } from "./issues.ts";
import type { Project, ProjectStageId } from "./project.ts";
import type { ProposalRecord } from "./proposal.ts";
import type { PurchaseOrder } from "./purchasing.ts";
import type { SelfSurveyDiffRow } from "./survey-visit.ts";

/**
 * The pilot learning loop: time, cost, learnings and the numbers that say
 * whether Pilot 2 went better than Pilot 1.
 *
 * Metrics are a pure function of the records (project, proposal, POs, time
 * log, issues), so the dashboard and the CSV always agree, and nothing is
 * typed in twice.
 *
 * Foundation ships the types and the learning prompts; F7 owns the logic.
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
}

export function pilotMetrics(input: {
  project: Project;
  proposal?: ProposalRecord;
  purchaseOrders: PurchaseOrder[];
  time: TimeEntry[];
  issues: Issue[];
  messagesSent: number;
  surveyDiff?: SelfSurveyDiffRow[];
}): PilotMetrics {
  throw new Error("not implemented: pilotMetrics (F7)");
}

export function pilotsCsv(rows: PilotMetrics[]): string {
  throw new Error("not implemented: pilotsCsv (F7)");
}
