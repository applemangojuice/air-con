import type { CommissioningRecord } from "./install.ts";
import type { Issue } from "./issues.ts";
import type { Invoice, Payment } from "./money.ts";
import type { ContractType, Project } from "./project.ts";
import type { AcceptanceRecord, ProposalOption, ProposalRecord, TermsSection } from "./proposal.ts";
import { isPlaceholderPhone, type PilotSettings } from "./settings.ts";
import type { SurveyRecord } from "./survey-visit.ts";

/**
 * Documents: immutable snapshots of what the customer was given.
 *
 * Each document freezes the data it was rendered from (`snapshot`), so a
 * proposal or certificate reads the same in a year as the day it was
 * issued. Rendering is print-perfect HTML in the web app; a new version
 * supersedes, it never overwrites. Refs are human-readable and unique.
 */

export type DocumentKind =
  | "proposal"
  | "contract"
  | "variation"
  | "invoice"
  | "receipt"
  | "commissioning-certificate"
  | "handover-pack"
  | "survey-report"
  | "certificate";

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  proposal: "Proposal",
  contract: "Contract confirmation",
  variation: "Variation",
  invoice: "Invoice",
  receipt: "Receipt",
  "commissioning-certificate": "Commissioning certificate",
  "handover-pack": "Handover pack",
  "survey-report": "Survey report",
  certificate: "Certificate",
};

/** Two-letter codes inside refs. Stable: refs are printed on paper. */
export const DOCUMENT_KIND_CODE: Record<DocumentKind, string> = {
  proposal: "PR",
  contract: "CT",
  variation: "VA",
  invoice: "IN",
  receipt: "RC",
  "commissioning-certificate": "CC",
  "handover-pack": "HP",
  "survey-report": "SR",
  certificate: "CE",
};

export interface DocumentRecord {
  id: string;
  projectId: string;
  kind: DocumentKind;
  version: number;
  ref: string;
  title: string;
  status: "draft" | "final" | "superseded";
  customerVisible: boolean;
  snapshot: unknown;
  createdAt: string;
  createdBy?: string;
}

const refPart = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The printed ref, unique across all documents (`documents.ref` is UNIQUE).
 *
 *   ("proposal", "7f3a91c2", 2)          → "DIH-PR-7F3A91C2-v2"
 *   ("invoice", "7f3a91c2", 1, "0002")   → "DIH-IN-7F3A91C2-0002-v1"
 *
 * `version` counts revisions of ONE document (proposal v1 → v2), not
 * documents of a kind. Kinds a project has several of (invoices, receipts,
 * variations) pass `instance` to tell them apart: the invoice number's
 * digits, the variation's issue number, the receipt's payment id. Use
 * `projectShortId` for the middle part: 4 characters collide across projects.
 */
export function documentRef(kind: DocumentKind, projectShortId: string, version: number, instance?: string): string {
  const short = refPart(projectShortId) || "X";
  const inst = instance === undefined ? "" : refPart(instance);
  return `DIH-${DOCUMENT_KIND_CODE[kind]}-${short}${inst ? `-${inst}` : ""}-v${Math.max(1, Math.floor(version))}`;
}

/** The first 8 letters and digits of a project id (a uuid's first block), upper-case, for refs. */
export function projectShortId(projectId: string): string {
  return refPart(projectId).slice(0, 8) || "X";
}

/* ------------------------------------------------------------------ */
/* Snapshots: what each kind of document freezes                       */
/* ------------------------------------------------------------------ */

/**
 * Who issued it, as printed: from settings at the moment of issue, so a
 * later change of address or certificate never rewrites an old document.
 */
export interface DocumentCompany {
  legalName: string;
  tradingName: string;
  /** Where we're established (CCR Sch 2(c)). Absent until settings hold one. */
  geographicAddress?: string;
  /** Left out while settings hold only the stand-in number (isPlaceholderPhone): a frozen document never prints it. */
  phone?: string;
  email: string;
  companyNumber?: string;
  vatNumber?: string;
  fgasCompanyCert?: { body: string; number: string; expiresOn?: string };
}

export interface DocumentCustomer {
  name: string;
  addressLine: string;
  postcode: string;
}

/** Every snapshot carries these. `issuedAt` is an ISO datetime. */
export interface DocumentHeader {
  company: DocumentCompany;
  customer: DocumentCustomer;
  issuedAt: string;
}

/** One installed unit, as the certificate and the handover pack list it. */
export interface InstalledEquipmentRow {
  /** The room name, or the system ("Outdoor unit, System 1") for outdoor units. */
  room: string;
  label: string;
  model: string;
  serial: string;
}

/**
 * The F-gas label in figures, one per outdoor unit: factory (pre-)charge,
 * charge added on site, the total, and its CO2 equivalent (kg × GWP / 1000).
 */
export interface FgasRecord {
  system: string;
  refrigerant: string;
  gwp: number;
  factoryChargeKg: number;
  additionalChargeKg: number;
  totalKg: number;
  tco2e: number;
}

/** A pointer from one document to another (the handover pack's index). */
export interface DocumentLink {
  kind: DocumentKind;
  ref: string;
  id: string;
  title: string;
}

export interface ProposalSnapshot extends DocumentHeader {
  /** Always the customer-safe view (customerSafeProposal): no cost lines, margins or overrides. */
  proposal: ProposalRecord;
}

/** The contract confirmation: what was accepted, by whom, on what terms (the durable copy). */
export interface ContractSnapshot extends DocumentHeader {
  proposalId: string;
  proposalVersion: number;
  proposalRef?: string;
  /** The accepted option, customer-safe. */
  option: ProposalOption;
  acceptance: AcceptanceRecord;
  contractType: ContractType;
  inclusions: string[];
  exclusions: string[];
  assumptions: string[];
  warranty: string | null;
  termsVersion: string;
  cancellation: { text: string; endsOn?: string; earlyStartRequested: boolean };
  /**
   * The payment schedule as agreed, frozen at acceptance so a later settings
   * change can't contradict the contract. `depositPence` is what the deposit
   * invoice charges (0: no deposit). Absent on contracts frozen before this
   * was recorded; the renderer then names no figures.
   */
  payments?: {
    depositPct: number;
    depositPence?: number;
    depositTiming: PilotSettings["payments"]["depositTiming"];
    balanceDueDays: number;
    methods: PilotSettings["payments"]["methods"];
  };
  /**
   * Schedule 2 (j) as agreed: we finish within `withinWeeks` of acceptance,
   * so by `byDate`, on dates agreed inside it. Absent on contracts made
   * before it was recorded.
   */
  performance?: { withinWeeks: number; byDate: string };
  /** Our complaints process and ADR as published when the contract was made. */
  complaints?: { process: string; adr?: string };
  /** The guarantee lines as given at acceptance. */
  guarantees?: string[];
  /** The full terms text the customer accepted (frozen on the proposal at issue), and its sha256. */
  termsText?: TermsSection[];
  termsHash?: string;
}

/** The customer-facing part of a variation issue: never its internal history. */
export type VariationIssue = Pick<Issue, "id" | "number" | "kind" | "title" | "detail" | "raisedAt" | "mediaIds"> & {
  variation: NonNullable<Issue["variation"]>;
};

export interface VariationSnapshot extends DocumentHeader {
  issue: VariationIssue;
  contractRef?: string;
  contractTotalPence?: number;
}

/** What a certificate document is: each kind is its own series of versions. */
export type CertificateKind = "electrical-installation" | "building-regulations" | "warranty-registration";

export const CERTIFICATE_KIND_LABEL: Record<CertificateKind, string> = {
  "electrical-installation": "Electrical installation certificate",
  "building-regulations": "Building Regulations compliance certificate",
  "warranty-registration": "Manufacturer warranty registration",
};

/**
 * A certificate or confirmation we hold for the customer: the file itself
 * (the scheme's PDF, a photo of the paper copy, the manufacturer's email)
 * and its reference. It exists before anything tells the customer it's "in
 * your documents".
 */
export interface CertificateSnapshot extends DocumentHeader {
  certificate: {
    kind: CertificateKind;
    title: string;
    /** The certificate or notification number, or the warranty registration reference. */
    reference?: string;
    /** Who issued it (the electrician's scheme, the manufacturer). */
    issuer?: string;
    receivedOn: string;
    /** The uploaded files (media ids on this project). */
    mediaIds: string[];
    note?: string;
  };
}

export interface InvoiceSnapshot extends DocumentHeader {
  invoice: Invoice;
  /** Verified payments against it at the moment of issue (usually none). */
  payments: Payment[];
  payTo?: {
    methods: ("card" | "bank-transfer")[];
    bank?: { accountName: string; sortCode: string; accountNumber: string };
    /** What to quote on a bank transfer: the invoice number. */
    reference: string;
  };
}

export interface ReceiptSnapshot extends DocumentHeader {
  payment: Payment;
  invoice?: Invoice;
}

export interface CommissioningCertificateSnapshot extends DocumentHeader {
  commissioning: CommissioningRecord;
  equipment: InstalledEquipmentRow[];
}

export interface HandoverPackSnapshot extends DocumentHeader {
  /** yyyy-mm-dd: the day the install was completed. The statutory clocks run from it. */
  completedOn: string;
  equipment: InstalledEquipmentRow[];
  commissioning: CommissioningRecord;
  documents: DocumentLink[];
  /** Warranty wording from settings (null: none stated), registered yet or due by. */
  warranty: { text: string | null; registered: boolean; dueOn?: string };
  /** Building Regulations compliance certificate: due within 30 days of completion (reg 20(3)). */
  electricalCert: { status: Project["handover"]["electricalCert"]; dueBy: string };
  /** Operating and maintenance information: due within 5 days of completion (reg 40(2)). */
  maintenanceInfo: { dueBy: string; provided: boolean };
  /** One per outdoor unit. */
  fgas: FgasRecord[];
  care: string[];
  contacts: { label: string; name?: string; phone?: string; email?: string }[];
  /**
   * The as-built photos: the customer-visible "completed" and "progress"
   * photos as they stood when the pack was published, newest first. Frozen
   * like the rest of the pack, so a later edit doesn't change what was handed
   * over. Absent on packs published before this was recorded.
   */
  asBuilt?: { mediaId: string; caption?: string }[];
}

export interface SurveyReportSnapshot extends DocumentHeader {
  survey: SurveyRecord;
  /** What we told the household happens next ("Your design arrives by …"). */
  promises: string[];
}

/** The snapshot each kind of document freezes. */
export interface DocumentSnapshots {
  proposal: ProposalSnapshot;
  contract: ContractSnapshot;
  variation: VariationSnapshot;
  invoice: InvoiceSnapshot;
  receipt: ReceiptSnapshot;
  "commissioning-certificate": CommissioningCertificateSnapshot;
  "handover-pack": HandoverPackSnapshot;
  "survey-report": SurveyReportSnapshot;
  certificate: CertificateSnapshot;
}

export type DocumentSnapshot<K extends DocumentKind = DocumentKind> = DocumentSnapshots[K];

/** A DocumentRecord whose snapshot is known to be of its kind. */
export type TypedDocumentRecord<K extends DocumentKind> = Omit<DocumentRecord, "kind" | "snapshot"> & {
  kind: K;
  snapshot: DocumentSnapshots[K];
};

// Compile-time: every DocumentKind has exactly one snapshot type.
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const SNAPSHOT_KINDS_COVERED: SameKeys<keyof DocumentSnapshots, DocumentKind> = true;
void SNAPSHOT_KINDS_COVERED;

/* ------------------------------------------------------------------ */
/* Snapshot helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Building Regulations 2010 reg 20(3): under self-certification the
 * compliance certificate goes to the occupier "not more than 30 days after
 * the completion of the work".
 */
export const ELECTRICAL_CERT_DUE_DAYS = 30;
/** Reg 40(2): operating and maintenance information "not later than five days after the work has been completed". */
export const MAINTENANCE_INFO_DUE_DAYS = 5;
/** R32, the refrigerant in every pilot system. tCO2e = kg × 675 / 1000. */
export const R32_GWP = 675;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The statutory due dates in the handover pack, from the day the install completed. */
export function handoverDeadlines(completedOnIso: string): { electricalCertDueBy: string; maintenanceInfoDueBy: string } {
  return {
    electricalCertDueBy: addDaysIso(completedOnIso, ELECTRICAL_CERT_DUE_DAYS),
    maintenanceInfoDueBy: addDaysIso(completedOnIso, MAINTENANCE_INFO_DUE_DAYS),
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The F-gas label for one outdoor unit: factory charge plus grams added on site. */
export function fgasRecord(input: {
  system: string;
  factoryChargeKg: number;
  additionalChargeG: number;
  refrigerant?: string;
  gwp?: number;
}): FgasRecord {
  const gwp = input.gwp ?? R32_GWP;
  const factoryChargeKg = round3(Math.max(0, input.factoryChargeKg));
  const additionalChargeKg = round3(Math.max(0, input.additionalChargeG) / 1000);
  const totalKg = round3(factoryChargeKg + additionalChargeKg);
  return {
    system: input.system,
    refrigerant: input.refrigerant ?? "R32",
    gwp,
    factoryChargeKg,
    additionalChargeKg,
    totalKg,
    tco2e: round3((totalKg * gwp) / 1000),
  };
}

/** The issuing company block, from settings. Blank optional details are left out, never printed empty. */
export function documentCompany(settings: PilotSettings): DocumentCompany {
  const c = settings.company;
  const filled = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  const geographicAddress = filled(c.geographicAddress);
  const companyNumber = filled(c.companyNumber);
  const vatNumber = settings.tax.vatRegistered ? filled(c.vatNumber) : undefined;
  return {
    legalName: c.legalName,
    tradingName: c.tradingName,
    ...(geographicAddress ? { geographicAddress } : {}),
    ...(isPlaceholderPhone(c.phone) ? {} : { phone: c.phone.trim() }),
    email: c.email,
    ...(companyNumber ? { companyNumber } : {}),
    ...(vatNumber ? { vatNumber } : {}),
    ...(c.fgasCompanyCert?.number ? { fgasCompanyCert: { ...c.fgasCompanyCert } } : {}),
  };
}

/** The customer block, from the project. */
export function documentCustomer(project: Pick<Project, "customer">): DocumentCustomer {
  return {
    name: project.customer.name,
    addressLine: project.customer.addressLine,
    postcode: project.customer.postcode,
  };
}
