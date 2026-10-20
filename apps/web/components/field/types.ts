import type {
  Annotation,
  CrewMember,
  InstallDay,
  InstallJobV2,
  IssueKind,
  IssueStatus,
  Project,
  Severity,
  StaffMember,
  StaffRole,
  VariationStatus,
} from "@aircon/domain";

/**
 * The field app's view models: what the server hands the pages, shaped
 * for the phone and stripped of anything a subcontractor mustn't see
 * (prices, margins, other customers). Types only, so client components can
 * import them freely.
 */

export interface RiskFlag {
  key: "height" | "asbestos" | "pets" | "services" | "survey-missing" | "pump";
  label: string;
  tone: "warn" | "danger" | "neutral";
}

export interface JobCard {
  projectId: string;
  kind: "install" | "survey";
  customerName: string;
  address: string;
  postcode: string;
  mapsUrl: string;
  customerPhone?: string;
  pilotLabel?: string;
  /** yyyy-mm-dd of the day this card is about. */
  date: string;
  /** Install: which day of how many. */
  dayN?: number;
  totalDays?: number;
  dayStatus?: InstallDay["status"];
  startedAt?: string;
  /** Survey: the slot (UK wall-clock as UTC). */
  scheduledFor?: string;
  surveyStatus?: Project["survey"]["status"];
  accessNotes?: string;
  parkingNotes?: string;
  crew: CrewMember[];
  risks: RiskFlag[];
  kitLabel?: string;
  kitTone?: "success" | "warn" | "neutral" | "info";
  /** Runsheet progress, 0-100, when the job has one. */
  progressPct?: number;
  installStatus?: Project["install"]["status"];
  handoverStatus?: Project["handover"]["status"];
  /** Commissioned today, crew still on site: what's left (the handover, ending the day). */
  wrapUp?: { handover: boolean; endDay: boolean };
  href: string;
}

export interface MyJobs {
  today: string;
  todayJobs: JobCard[];
  upcoming: JobCard[];
  recent: JobCard[];
  /** Everyone else's installs and surveys today, for staff with the board-wide view. */
  team: JobCard[];
}

export interface Quals {
  fgas: boolean;
  electrical: boolean;
  techLead: boolean;
}

export interface FieldMe {
  id: string;
  name: string;
  roles: StaffRole[];
  external: boolean;
  quals: Quals;
  canReview: boolean;
  canSign: boolean;
  /** Ops can open the command centre (board-wide view). */
  canViewAll: boolean;
  /** The same person for the domain's client-side checks (canRecord): roles and their verified qualifications' kinds and expiry, no certificate numbers or files. */
  staff: StaffMember;
}

export interface FieldIssue {
  id: string;
  projectId: string;
  number: number;
  kind: IssueKind;
  title: string;
  detail?: string;
  severity: Severity;
  status: IssueStatus;
  blocking: boolean;
  raisedAt: string;
  raisedBy: string;
  customerVisible: boolean;
  /** Variation decision; the money only for staff who may see prices. */
  variation?: { status: VariationStatus; totalDeltaPence?: number; description: string; start?: { state: "go" | "wait" | "none"; text: string } };
  mediaUrls: string[];
  customerName?: string;
}

export interface FieldHeader {
  projectId: string;
  customerName: string;
  address: string;
  postcode: string;
  mapsUrl: string;
  customerPhone?: string;
  accessNotes?: string;
  parkingNotes?: string;
  pilotLabel?: string;
  dates: string[];
  days: InstallDay[];
  totalDays: number;
  /** The day under way (started, not ended), if any. */
  currentDay: number | null;
  /** The next day to start, if any. */
  nextDay: number | null;
  crew: CrewMember[];
  installStatus: Project["install"]["status"];
  handoverStatus: Project["handover"]["status"];
  bookingStatus: Project["booking"]["status"];
  kitLabel: string;
  kitTone: "success" | "warn" | "neutral" | "info";
  risks: RiskFlag[];
  onMyWay?: { at: string; etaMinutes: number; by: string };
  packDocumentId?: string;
  signoff?: Project["handover"]["signoff"];
  electricalCert: Project["handover"]["electricalCert"];
  today: string;
  /**
   * How far along the project's record this was read (its event count,
   * which only grows): a step's own answer with a higher version is newer
   * than this page data, a refresh with a higher one is newer than the
   * answer (components/field/answers.ts, withHeaderState).
   */
  version: number;
}

/** The parts of the header a step on the phone changes, as the server answers it (version included). */
export type FieldHeaderState = Pick<
  FieldHeader,
  "version" | "days" | "totalDays" | "currentDay" | "nextDay" | "installStatus" | "handoverStatus" | "bookingStatus" | "onMyWay" | "packDocumentId" | "signoff" | "electricalCert"
>;

export interface FieldClock {
  entryId: string;
  startedAt: string;
  kind: string;
  dayN?: number;
}

/** Everything the runsheet needs, shared by the day, commissioning and handover screens. */
export interface FieldJob {
  header: FieldHeader;
  /** Null with a reason when there's no runsheet yet (no approved design, booking not confirmed…). */
  job: InstallJobV2 | null;
  jobProblem?: string;
  me: FieldMe;
  clock: FieldClock | null;
  /** This person has clocked on to this job today (London), running or not: "Resume", not "Arrived". */
  clockedToday: boolean;
  issues: FieldIssue[];
  /** Signed read URLs for the photos already captured on the runsheet. */
  mediaUrls: Record<string, string>;
  /** What the outbox mode is (the SMS and email honesty line). */
  smsMode: "live" | "demo";
  emailMode: "live" | "demo";
}

export interface LayoutPhoto {
  id: string;
  url: string | null;
  annotations: Annotation[];
  width?: number;
  height?: number;
  caption?: string;
}

export interface PackRoom {
  roomId: string;
  name: string;
  floor?: string;
  unitLabel: string;
  model: string;
  pipeRunM?: number;
  condensate?: "gravity" | "pump";
  photos: LayoutPhoto[];
}

export interface PackMaterial {
  key: string;
  label: string;
  qty: number;
  unit?: string;
  /** Where it's coming from and whether it's arrived. */
  status?: string;
  source: "po" | "bom";
}

export interface PackDocument {
  id: string;
  title: string;
  ref: string;
  kind: string;
  href: string;
}

export interface JobPack extends FieldJob {
  rooms: PackRoom[];
  outside: { label: string; photos: LayoutPhoto[]; note?: string }[];
  materials: PackMaterial[];
  tools: { label: string; why?: string }[];
  rams: { acknowledged: { by: string; at: string }[]; mine: boolean; specId?: string; guidance?: string };
  instructions: string[];
  documents: PackDocument[];
  /** Plain scope for people who don't see the priced documents. */
  scope: string[];
  designNote?: string;
}
