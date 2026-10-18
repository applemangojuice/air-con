import type { ContractType, ProposalOption } from "@aircon/domain";
import type { ProposalMedia } from "@/lib/proposal-server";

/**
 * What the customer proposal page hands its client components: plain,
 * serialisable, customer-safe data (no costs, margins or internal notes),
 * with every sentence that depends on settings already worked out on the
 * server.
 */

export type ProposalPageState = "open" | "changes-requested" | "expired" | "declined" | "accepted";

export interface ProposalPageData {
  proposalId: string;
  projectId: string;
  version: number;
  ref?: string;
  state: ProposalPageState;
  /** "preview": staff previewing a draft; "staff": staff viewing the live page; "customer": the customer. */
  viewer: "customer" | "staff" | "preview";
  documentHash: string;
  firstName: string;
  place: string;
  email?: string;
  options: ProposalOption[];
  inclusions: string[];
  exclusions: string[];
  assumptions: string[];
  guarantees: string[];
  validUntil: string;
  increaseReason?: string;
  instantPricePence: number;
  contractType: ContractType;
  termsVersion: string;
  media: Record<string, ProposalMedia>;
  approvedBy?: string;
  foundingPilot: boolean;
  vatRegistered: boolean;
  company: { tradingName: string; legalName: string; phone: string; email: string };
  /** Per option id: "No VAT: we're not VAT registered" or the VAT treatment. */
  vatNotes: Record<string, string>;
  /** Per option id: the payment terms, deposit worked out on that option's total. */
  paymentTerms: Record<string, string[]>;
  extraCharges: string;
  earliestStart: string;
  cancellation: {
    /** The plain sentence before they accept. */
    summary: string;
    days: number;
    instructions: { heading?: string; text: string }[];
    form: string[];
    reviewed: boolean;
  };
  earlyStart: { wording: string; wordingVersion: string };
  documents: { proposal?: { id: string; ref: string }; contract?: { id: string; ref: string } };
  accepted?: {
    optionId: string;
    optionLabel: string;
    totalPence: number;
    at: string;
    name: string;
    earlyStartRequested: boolean;
    earlyStartEvidenced: boolean;
    cancellation: string;
  };
  changeRequest?: string;
  declineReason?: string;
}
