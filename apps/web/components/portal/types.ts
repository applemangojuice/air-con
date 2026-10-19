import type {
  Blocker,
  DocumentKind,
  IssueKind,
  IssueStatus,
  Project,
  ProjectStageId,
  StageInfo,
  VariationStatus,
} from "@aircon/domain";
import type { EarliestReason, InstallBlock, SurveySlotDay } from "./schedule";

/**
 * The customer hub's data, as the browser receives it: everything already
 * decided and customer-safe (no costs, margins, settings internals, other
 * customers or internal notes). The server builds it from the database
 * (lib/portal-server.ts); the demo builds it in the browser from the same
 * pure pieces (view.ts), so both render through one component tree.
 */

export interface PersonCard {
  name: string;
  /** "Surveyor", "Installer, Technical lead". */
  role: string;
  photoUrl: string | null;
  bio?: string;
  /** Plain labels of qualifications that are current today, e.g. "F-gas Category I". */
  qualifications: string[];
}

export interface HubDocument {
  id: string;
  kind: DocumentKind;
  title: string;
  ref: string;
  version: number;
  status: "draft" | "final" | "superseded";
  createdAt: string;
}

export interface HubPhoto {
  id: string;
  url: string | null;
  caption?: string;
  width?: number;
  height?: number;
}

export interface HubIssue {
  id: string;
  number: number;
  kind: IssueKind;
  title: string;
  detail?: string;
  status: IssueStatus;
  raisedAt: string;
  /** Who raised it, from the customer's side of the table. */
  raisedBy: "you" | "us";
  dueOn?: string;
  resolution?: string;
  resolvedAt?: string;
  photos: HubPhoto[];
  variation?: {
    description: string;
    priceDeltaNetPence: number;
    taxPence: number;
    totalDeltaPence: number;
    status: VariationStatus;
    decidedAt?: string;
    decidedBy?: string;
  };
}

export interface HubInvoice {
  id: string;
  number: string;
  kind: string;
  status: string;
  totalPence: number;
  paidPence: number;
  dueOn?: string;
  issuedAt?: string;
  documentId?: string;
}

export interface HubCommissioning {
  at: string;
  by: string;
  qualificationRef?: string;
  systems: number;
}

/** Settings-derived facts the screens need, already turned into words. */
export interface HubFacts {
  stages: Record<ProjectStageId, StageInfo>;
  /** `phone` is null while settings hold only the placeholder number: say "email us" instead. */
  company: { tradingName: string; phone: string | null; email: string; reviewUrl?: string };
  scheduling: { surveyDurationMinutes: number; installBlockDays: number; cancellationDays: number };
  warranty: { workmanshipYears: number | null; manufacturerSummary: string | null };
  cancellation: {
    sentence: string;
    endsOn?: string;
    ended: boolean;
    basis: "acceptance" | "goods-delivery" | "unknown";
    earlyStartEvidenced: boolean;
  };
  earlyStartWording: string;
  /** Short-notice fees for moving dates, in pounds, from the published fee table. */
  fees: { surveyShortNoticeGbp: number; installShortNoticeGbp: number };
}

export interface HubViewer {
  kind: "customer" | "staff" | "demo";
  /** Staff: their name, for the "viewing as" strip. */
  name?: string;
}

export interface HubData extends HubFacts {
  project: Project;
  /** London date (yyyy-mm-dd) and the server's clock, so every screen counts from the same day. */
  today: string;
  nowIso: string;
  viewer: HubViewer;
  surveyor: PersonCard | null;
  crew: PersonCard[];
  surveySlots: SurveySlotDay[];
  installBlocks: InstallBlock[];
  earliestStart: { date: string; reason: EarliestReason };
  documents: HubDocument[];
  issues: HubIssue[];
  invoices: HubInvoice[];
  money: { invoicedPence: number; paidPence: number; outstandingPence: number };
  /** Media id → photo, for the end-of-day updates. */
  photos: Record<string, HubPhoto>;
  commissioning: HubCommissioning | null;
  /** The published handover pack's paperwork position, from its snapshot. */
  pack: HubPack | null;
}

export interface HubPack {
  documentId: string;
  completedOn: string;
  electricalCert: { status: "pending" | "received" | "not-required"; dueBy: string };
  maintenanceInfo: { dueBy: string; provided: boolean };
  warranty: { text: string | null; registered: boolean; dueOn?: string };
}

/** What the hub asks of its controller (the API for real projects, the reducer for the demo). */
export type PortalRequest =
  | { kind: "book-survey"; scheduledFor: string; mode: "in-person" | "video"; documentsConsent: boolean }
  | { kind: "reschedule-survey"; scheduledFor: string }
  | { kind: "documents-consent" }
  | { kind: "install-dates"; dates: string[] }
  | { kind: "prep"; itemId: string; done: boolean }
  | { kind: "feedback"; score: number; comments?: string }
  | { kind: "early-start" }
  | { kind: "follow-ups"; optedOut: boolean }
  /** Accepting needs the typed full name and the "I agree to pay …" press (`agreed`). */
  | { kind: "variation"; issueId: string; decision: "accept" | "decline"; name?: string; agreed?: boolean }
  | { kind: "problem"; title: string; detail: string; mediaIds: string[] };

export type PortalResult = { ok: true; message?: string } | { ok: false; error: string; blockers?: Blocker[] };
