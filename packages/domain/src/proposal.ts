import type { CostLine, LabourPlan, OptionPricing, PriceLine } from "./costing.ts";
import type { PilotSettings } from "./settings.ts";

/**
 * The proposal: one or two priced options built on an approved design,
 * plus the customer's acceptance record.
 *
 * Versioned and immutable once accepted. Changes before acceptance make a
 * new version (`reviseProposal`); changes after it are numbered variations
 * (issues.ts). The customer view strips costs, margins and overrides.
 *
 * Foundation ships the types; F4 owns the logic and the default wording.
 */

export interface RoomCard {
  roomId: string;
  roomName: string;
  unitName: string;
  why: string;
  highlights: string[];
  mediaIds: string[];
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
}

export const DEFAULT_INCLUSIONS: string[] = []; // F4: replace
export const DEFAULT_EXCLUSIONS: string[] = []; // F4: replace
/**
 * The contract calls this DEFAULT_ASSUMPTIONS; renamed because
 * intelligence.ts already exports DEFAULT_ASSUMPTIONS (campaign maths) from
 * the same package index.
 */
export const DEFAULT_PROPOSAL_ASSUMPTIONS: string[] = []; // F4: replace

export function proposalIssueErrors(p: ProposalRecord, settings: PilotSettings, todayIso: string): string[] {
  throw new Error("not implemented: proposalIssueErrors (F4)");
}

export function acceptanceErrors(p: ProposalRecord, a: Omit<AcceptanceRecord, "at">, todayIso: string): string[] {
  throw new Error("not implemented: acceptanceErrors (F4)");
}

/** A new draft version; never mutates an accepted one. */
export function reviseProposal(p: ProposalRecord, newId: string, now: string): ProposalRecord {
  throw new Error("not implemented: reviseProposal (F4)");
}

/** Strips costLines, margins and overrides for customer pages. */
export function customerSafeProposal(p: ProposalRecord): ProposalRecord {
  throw new Error("not implemented: customerSafeProposal (F4)");
}
