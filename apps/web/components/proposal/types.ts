import type { ContractType, ProposalOption, TermsSection } from "@aircon/domain";
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
  /**
   * The issue email (the pre-contract information and cancellation form on
   * a durable medium) hasn't been recorded as delivered yet, so this version
   * can't be accepted until it has.
   */
  infoPending?: boolean;
  /** No email provider on this (demo) deployment: messages are stored, never sent, so no copy may say "we emailed". */
  emailDemo?: boolean;
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
  /** The full terms text frozen on this version at issue (absent on drafts and older versions). */
  termsText?: TermsSection[];
  media: Record<string, ProposalMedia>;
  approvedBy?: string;
  foundingPilot: boolean;
  vatRegistered: boolean;
  /** `phone` is null while settings hold only the stand-in number: the page says "email us" instead. */
  company: { tradingName: string; legalName: string; phone: string | null; email: string };
  /** Per option id: "No VAT: we're not VAT registered" or the VAT treatment. */
  vatNotes: Record<string, string>;
  /** Per option id: the payment terms, deposit worked out on that option's total. */
  paymentTerms: Record<string, string[]>;
  extraCharges: string;
  earliestStart: string;
  /** Schedule 2 (j): the time by which we undertake to finish (performanceCommitment, from the frozen terms). */
  performance: string;
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
    confirmationSentAt?: string;
  };
  changeRequest?: string;
  declineReason?: string;
}
