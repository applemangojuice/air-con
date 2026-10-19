import {
  COMMS_EVENTS,
  DEFAULT_SETTINGS,
  EARLY_START_WORDING_VERSION,
  GATE_IDS,
  NUMERIC_KINDS,
  proposalTermsFrom,
  TAX_CODES,
  applyProjectAction,
  buildRunsheet,
  createProject,
  customerSafeProposal,
  designVerdict,
  documentCompany,
  documentCustomer,
  effectiveTaxCode,
  fgasRecord,
  generateQuote,
  guaranteeLines,
  handoverDeadlines,
  idempotencyKey,
  PROPOSAL_TURNAROUND_WORKING_DAYS,
  depositPence as depositPenceOf,
  isPlaceholderPhone,
  mergeSettings,
  pipeNoteFor,
  plausibleValue,
  scoreInstallation,
  type AcceptanceRecord,
  type CatalogueItem,
  type CommissioningRecord,
  type CommsEventId,
  type CompatibilityRule,
  type ComplianceItem,
  type CostLine,
  type DesignBomLine,
  type DesignRecord,
  type DesignVariant,
  type DocumentKind,
  type DocumentRecord,
  type DocumentSnapshots,
  type EvidenceRecord,
  type FloorLevel,
  type GlazingLevel,
  type InstallStep,
  type InstalledEquipmentRow,
  type Invoice,
  type Issue,
  type LabourPlan,
  type Learning,
  type MeasuredRoom,
  type MeasuredSurvey,
  type MediaItem,
  type MessageRecord,
  type OptionPricing,
  type Orientation,
  type OutdoorPosition,
  type Payment,
  type PhotoTag,
  type PilotSettings,
  type PriceLine,
  type Project,
  type ProjectAction,
  type ProposalOption,
  type ProposalRecord,
  type PurchaseOrder,
  type QuoteResult,
  type ReadinessContext,
  type RoomSize,
  type RoomType,
  type RuleResult,
  type StaffMember,
  type StaffRole,
  type StepStatusRecord,
  type Survey,
  type SurveyRecord,
  type TimeEntry,
} from "@aircon/domain";
import { DEMO_STAFF } from "../auth/demo-staff.ts";
import { documentInstance, planDocument } from "../documents-server";
import { fmtDate } from "../format.ts";
import type { InstallJobParts } from "../repo/installJobs";
import { DEMO_CATALOGUE_ITEMS, DEMO_COMPATIBILITY_RULES, demoItem } from "./catalogue.ts";
import { demoChecklist, keysUpTo, type ChecklistState } from "./compliance.ts";
import { addDays, at, londonDate, nextWorkingDay, prevWorkingDay, workingDaysEnding, workingDaysFrom } from "./dates.ts";
import { demoId } from "./ids.ts";
import { DEMO_PHOTO_HEIGHT, DEMO_PHOTO_WIDTH, demoPhoto, type DemoScene } from "./photos.ts";

/**
 * The DEMO pilots: five fictional homes, each at a different point of the
 * journey, built through the REAL reducer (applyProjectAction) with a demo
 * readiness context whose facts come from the records built alongside. Any
 * gate a record doesn't actually satisfy refuses, and the build throws, so
 * the seed can't drift into an impossible state.
 *
 *   DEMO 1  single split, simple            survey booked (in person, 3 days out)
 *   DEMO 2  multiple single splits          proposal issued: Standard + Quiet, PILOT15
 *   DEMO 3  verified multi-split            accepted (early start evidenced), booked, kit in: ready to install
 *   DEMO 4  complex pipe routing            design in review, blocking loft-route issue, override with reason
 *   DEMO 5  completed                       handed over 10 days ago, paid, closed, feedback 9/10
 *
 * Pure and deterministic: (now, settings) → the same dataset. Ids come from
 * `demoId`, timestamps from the story's own calendar relative to `now`.
 * The design and proposal records are built by hand to the exact domain
 * types, so the story stays fixed whatever the pricing rules do.
 * Everything is labelled DEMO: names end "(DEMO)", emails are @example.com,
 * addresses are "Demo Street", catalogue ids start "demo-".
 */

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

export interface DemoQuoteRow {
  id: string;
  created_at: string;
  customer_name: string;
  email: string;
  phone: string;
  timeframe: string;
  postcode: string;
  address_line: string;
  engine_version: string;
  survey: Survey;
  quote: QuoteResult;
  total_gbp: number;
  room_count: number;
  confidence_score: number;
  confidence_band: string;
  status: string;
  source: "demo";
}

export interface DemoCustomer {
  id: string;
  email: string;
  name: string;
  phone: string;
  createdAt: string;
}

export interface DemoMedia {
  item: MediaItem;
  fileName: string;
  svg: string;
}

export interface DemoDocument<K extends DocumentKind = DocumentKind> {
  id: string;
  kind: K;
  title: string;
  customerVisible: boolean;
  createdBy?: string;
  createdAt: string;
  snapshot: DocumentSnapshots[K];
  /** What createDocument will assign, planned here so the handover pack can link to it. */
  ref: string;
  version: number;
}

export type StoredEvidenceRecord = EvidenceRecord & { id: string };

export interface DemoProject {
  n: number;
  key: string;
  label: string;
  quote: DemoQuoteRow;
  customer: DemoCustomer;
  project: Project;
  survey?: SurveyRecord;
  design?: DesignRecord;
  proposal?: ProposalRecord;
  compliance: ComplianceItem[];
  purchaseOrders: PurchaseOrder[];
  installJob?: InstallJobParts;
  evidence: StoredEvidenceRecord[];
  issues: Issue[];
  time: TimeEntry[];
  invoices: Invoice[];
  payments: Payment[];
  messages: MessageRecord[];
  documents: DemoDocument[];
  learnings: Learning[];
  media: DemoMedia[];
  /** The readiness context the final state was built against (tests replay gates with it). */
  ctx: ReadinessContext;
}

export interface DemoDataset {
  now: string;
  today: string;
  settings: PilotSettings;
  catalogue: CatalogueItem[];
  compatibility: CompatibilityRule[];
  staff: StaffMember[];
  projects: DemoProject[];
}

/* ------------------------------------------------------------------ */
/* People and settings                                                 */
/* ------------------------------------------------------------------ */

const ADMIN = DEMO_STAFF.admin;
const SURVEYOR = DEMO_STAFF.surveyor;
const TECH = DEMO_STAFF["tech-lead"];
const INSTALLER = DEMO_STAFF.installer;
const ELECTRICIAN = DEMO_STAFF.electrician;
const SUBCONTRACTOR = DEMO_STAFF["external-installer"];

const crewMember = (s: StaffMember, role: StaffRole) => ({ staffId: s.id, name: s.name, role, external: s.external });
const techRef = () => TECH.qualifications.find((q) => q.kind === "fgas-cat1")?.reference ?? "DEMO-FGAS";

/**
 * The business settings the demo story runs under: the real settings, with
 * DEMO stand-ins only where a legally required detail is still blank (so a
 * DEMO proposal can issue on a fresh install) and a 20% deposit, so the
 * deposit path shows. Used for the demo build only; nothing is saved.
 */
export function demoSettings(base: PilotSettings = DEFAULT_SETTINGS): PilotSettings {
  return mergeSettings({
    ...base,
    company: {
      ...base.company,
      geographicAddress: base.company.geographicAddress?.trim() || "DEMO address: 1 Demo Street, London SW16 9ZZ",
      // Ofcom's drama range (020 7946 0xxx): never a real line.
      phone: isPlaceholderPhone(base.company.phone) ? "020 7946 0123" : base.company.phone,
      complaintsProcess:
        base.company.complaintsProcess?.trim() ||
        "DEMO: tell us by phone or email and we reply within two working days.",
    },
    warranty: {
      workmanshipYears: base.warranty.workmanshipYears,
      manufacturerSummary:
        base.warranty.manufacturerSummary ?? "DEMO: manufacturer's parts warranty once the system is registered.",
    },
    payments: { ...base.payments, depositPct: 20, depositTiming: "on-acceptance" },
    // The story's calendar: three-day installs, Monday to Friday, the statutory 14 days.
    scheduling: { ...base.scheduling, installBlockDays: 3, workingDays: [1, 2, 3, 4, 5], cancellationDays: 14 },
    pricing: { ...base.pricing, quoteValidityDays: Math.max(14, base.pricing.quoteValidityDays) },
  });
}

/* ------------------------------------------------------------------ */
/* Scenario specs                                                      */
/* ------------------------------------------------------------------ */

type Stop = "survey-booked" | "design-review" | "proposal-issued" | "ready-to-install" | "closed";

interface RoomSpec {
  key: string;
  name: string;
  type: RoomType;
  size: RoomSize;
  floor: FloorLevel;
  glazing: GlazingLevel;
  orientation: Orientation;
  lengthM: number;
  widthM: number;
  pipeRunM: number;
  heightDropM: number;
  route: NonNullable<MeasuredRoom["route"]>;
  routeNote?: string;
  condensate: "gravity" | "pump";
  hasExternalWall: boolean;
  std: string;
  prem?: string;
}

interface SystemSpec {
  key: string;
  label: string;
  roomKeys: string[];
  std: string;
  prem?: string;
  position: Omit<OutdoorPosition, "id" | "mediaId" | "chosen">;
}

interface Scenario {
  n: number;
  key: string;
  label: string;
  stop: Stop;
  customer: { name: string; signName: string; email: string; phone: string; addressLine: string; postcode: string };
  house: Pick<MeasuredSurvey["house"], "type" | "era" | "wallConstruction" | "storeys" | "listedOrConservation" | "asbestosRisk"> & {
    asbestosNote?: string;
    bedrooms: number;
  };
  rooms: RoomSpec[];
  systems: SystemSpec[];
  /** A Quiet (premium) option alongside Standard. */
  premium?: boolean;
  discountCode?: "PILOT15" | "PILOT30";
  earlyStart?: boolean;
  wishes: MeasuredSurvey["wishes"];
  access: { accessNotes: string; parkingNotes: string };
  /** The survey slot's hour (settings slots are 10:00, 13:00, 16:00), so two surveys never share a slot. */
  surveyHour?: number;
}

const SCENARIOS: Scenario[] = [
  {
    n: 1,
    key: "demo1",
    label: "DEMO 1 · Single split, simple",
    stop: "survey-booked",
    customer: {
      name: "Alex Rivers (DEMO)",
      signName: "Alex Rivers",
      email: "demo.alex.rivers@example.com",
      phone: "07700 900101",
      addressLine: "1 Demo Street",
      postcode: "SW16 9ZZ",
    },
    house: { type: "semi-detached", era: "1930-1950", wallConstruction: "cavity", storeys: 2, listedOrConservation: "no", asbestosRisk: "none-suspected", bedrooms: 3 },
    rooms: [
      { key: "r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", lengthM: 4.2, widthM: 3.4, pipeRunM: 5, heightDropM: 3, route: "external-trunking", condensate: "gravity", hasExternalWall: true, std: "demo-ind-brz25" },
    ],
    systems: [
      { key: "s1", label: "System", roomKeys: ["r1"], std: "demo-out-brz25", position: { label: "Rear patio, by the kitchen door", location: "ground-rear", base: "ground-feet", accessEquipment: "none", distanceToNeighbourWindowM: 5 } },
    ],
    wishes: { priorities: ["quiet", "cooling"], heatingUse: "supplementary", timing: "Before next summer" },
    access: { accessNotes: "Side gate on the left of the house (DEMO).", parkingNotes: "Free on-street parking (DEMO)." },
  },
  {
    n: 2,
    key: "demo2",
    label: "DEMO 2 · Multiple single splits",
    stop: "proposal-issued",
    customer: {
      name: "Jordan Okafor (DEMO)",
      signName: "Jordan Okafor",
      email: "demo.jordan.okafor@example.com",
      phone: "07700 900102",
      addressLine: "2 Demo Road",
      postcode: "SW17 9ZZ",
    },
    house: { type: "terraced", era: "1950-2000", wallConstruction: "cavity", storeys: 2, listedOrConservation: "no", asbestosRisk: "none-suspected", bedrooms: 3 },
    rooms: [
      { key: "r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "west", lengthM: 4.0, widthM: 3.5, pipeRunM: 6, heightDropM: 3, route: "external-trunking", condensate: "gravity", hasExternalWall: true, std: "demo-ind-brz25", prem: "demo-ind-whs25" },
      { key: "r2", name: "Living room", type: "living-room", size: "large", floor: "ground", glazing: "high", orientation: "south", lengthM: 5.6, widthM: 3.9, pipeRunM: 3, heightDropM: 0.5, route: "through-wall", condensate: "gravity", hasExternalWall: true, std: "demo-ind-brz35", prem: "demo-ind-whs35" },
    ],
    systems: [
      { key: "s1", label: "System 1 (Main bedroom)", roomKeys: ["r1"], std: "demo-out-brz25", prem: "demo-out-whs25", position: { label: "Rear patio, left", location: "ground-rear", base: "ground-feet", accessEquipment: "none", distanceToNeighbourWindowM: 4.5 } },
      { key: "s2", label: "System 2 (Living room)", roomKeys: ["r2"], std: "demo-out-brz35", prem: "demo-out-whs35", position: { label: "Side return, by the bins", location: "ground-side", base: "ground-feet", accessEquipment: "none", distanceToNeighbourWindowM: 3.2 } },
    ],
    premium: true,
    discountCode: "PILOT15",
    wishes: { priorities: ["quiet", "heating", "smart-control"], heatingUse: "supplementary", timing: "Spring", notes: "Wants the bedroom unit as quiet as possible (DEMO)." },
    access: { accessNotes: "Rear garden through the side return (DEMO).", parkingNotes: "Controlled zone: visitor permit needed (DEMO)." },
  },
  {
    n: 3,
    key: "demo3",
    label: "DEMO 3 · Verified multi-split",
    stop: "ready-to-install",
    customer: {
      name: "Morgan Patel (DEMO)",
      signName: "Morgan Patel",
      email: "demo.morgan.patel@example.com",
      phone: "07700 900103",
      addressLine: "3 Demo Gardens",
      postcode: "SE19 9ZZ",
    },
    house: { type: "detached", era: "2000+", wallConstruction: "cavity", storeys: 2, listedOrConservation: "no", asbestosRisk: "none-suspected", bedrooms: 4 },
    rooms: [
      { key: "r1", name: "Main bedroom", type: "bedroom", size: "large", floor: "first", glazing: "medium", orientation: "south", lengthM: 4.6, widthM: 3.8, pipeRunM: 7, heightDropM: 3, route: "external-trunking", condensate: "gravity", hasExternalWall: true, std: "demo-ind-brz35" },
      { key: "r2", name: "Second bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "west", lengthM: 3.6, widthM: 3.2, pipeRunM: 9, heightDropM: 3, route: "external-trunking", condensate: "gravity", hasExternalWall: true, std: "demo-ind-brz25" },
      { key: "r3", name: "Home office", type: "home-office", size: "small", floor: "first", glazing: "low", orientation: "east", lengthM: 3.0, widthM: 2.6, pipeRunM: 11, heightDropM: 3, route: "external-trunking", condensate: "gravity", hasExternalWall: true, std: "demo-ind-brz25" },
    ],
    systems: [
      { key: "s1", label: "System", roomKeys: ["r1", "r2", "r3"], std: "demo-out-trio52", position: { label: "Rear garden, against the garage wall", location: "ground-rear", base: "slab", accessEquipment: "ladder", distanceToNeighbourWindowM: 6 } },
    ],
    discountCode: "PILOT15",
    earlyStart: true,
    wishes: { priorities: ["cooling", "smart-control"], heatingUse: "supplementary", timing: "As soon as possible", notes: "Works from home: the office matters most (DEMO)." },
    access: { accessNotes: "Side gate on the right; the dog stays in the kitchen (DEMO).", parkingNotes: "Driveway: room for the van (DEMO)." },
  },
  {
    n: 4,
    key: "demo4",
    label: "DEMO 4 · Complex pipe routing (needs review)",
    stop: "design-review",
    customer: {
      name: "Casey Lindqvist (DEMO)",
      signName: "Casey Lindqvist",
      email: "demo.casey.lindqvist@example.com",
      phone: "07700 900104",
      addressLine: "4 Demo Terrace",
      postcode: "SW2 9ZZ",
    },
    house: {
      type: "terraced",
      era: "pre-1930",
      wallConstruction: "solid-brick",
      storeys: 3,
      listedOrConservation: "unknown",
      asbestosRisk: "possible",
      asbestosNote: "Loose grey-brown loft insulation in one bay: could be vermiculite. Sample before work up there (DEMO).",
      bedrooms: 3,
    },
    rooms: [
      {
        key: "r1",
        name: "Main bedroom",
        type: "bedroom",
        size: "medium",
        floor: "second-plus",
        glazing: "medium",
        orientation: "north",
        lengthM: 4.1,
        widthM: 3.6,
        pipeRunM: 15,
        heightDropM: 8,
        route: "via-loft",
        routeNote: "No usable external wall at the front (conservation area side): through the loft and down the rear gable (DEMO).",
        condensate: "pump",
        hasExternalWall: false,
        std: "demo-ind-brz25",
      },
      { key: "r2", name: "Loft bedroom", type: "loft-room", size: "small", floor: "loft", glazing: "high", orientation: "south", lengthM: 3.4, widthM: 3.0, pipeRunM: 8, heightDropM: 9, route: "external-trunking", condensate: "gravity", hasExternalWall: true, std: "demo-ind-brz25" },
    ],
    systems: [
      { key: "s1", label: "System", roomKeys: ["r1", "r2"], std: "demo-out-duo50", position: { label: "Rear garden, against the boundary wall", location: "ground-rear", base: "ground-feet", accessEquipment: "tower", distanceToNeighbourWindowM: 3.5 } },
    ],
    wishes: { priorities: ["discreet", "quiet"], heatingUse: "supplementary", notes: "Nothing visible from the street (DEMO)." },
    surveyHour: 13,
    access: { accessNotes: "Narrow stairs to the loft (DEMO).", parkingNotes: "Pay and display, two-hour limit (DEMO)." },
  },
  {
    n: 5,
    key: "demo5",
    label: "DEMO 5 · Completed",
    stop: "closed",
    customer: {
      name: "Robin Hart (DEMO)",
      signName: "Robin Hart",
      email: "demo.robin.hart@example.com",
      phone: "07700 900105",
      addressLine: "5 Demo Avenue",
      postcode: "SW12 9ZZ",
    },
    house: { type: "semi-detached", era: "1930-1950", wallConstruction: "solid-brick", storeys: 2, listedOrConservation: "no", asbestosRisk: "none-suspected", bedrooms: 3 },
    rooms: [
      { key: "r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", lengthM: 4.0, widthM: 3.6, pipeRunM: 8, heightDropM: 3, route: "external-trunking", condensate: "gravity", hasExternalWall: true, std: "demo-ind-brz25" },
      { key: "r2", name: "Living room", type: "living-room", size: "large", floor: "ground", glazing: "high", orientation: "west", lengthM: 5.5, widthM: 4.0, pipeRunM: 5, heightDropM: 0.5, route: "through-wall", condensate: "gravity", hasExternalWall: true, std: "demo-ind-brz35" },
    ],
    systems: [
      { key: "s1", label: "System", roomKeys: ["r1", "r2"], std: "demo-out-duo50", position: { label: "Rear patio, under the kitchen window", location: "ground-rear", base: "ground-feet", accessEquipment: "none", distanceToNeighbourWindowM: 4.5 } },
    ],
    discountCode: "PILOT30",
    wishes: { priorities: ["quiet", "heating"], heatingUse: "supplementary", timing: "Before the autumn" },
    access: { accessNotes: "Rear access through the garage (DEMO).", parkingNotes: "Driveway (DEMO)." },
  },
];

/* ------------------------------------------------------------------ */
/* The story machine                                                   */
/* ------------------------------------------------------------------ */

/** Thrown when the demo story asks the reducer for something its own records don't support. */
export class DemoSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoSeedError";
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** 123456 → "£1,234.56"; 120000 → "£1,200". Hand-rolled: the same on every runtime. */
const fmtGbp = (pence: number) => {
  const abs = Math.abs(Math.round(pence));
  const pounds = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const p = abs % 100;
  return `${pence < 0 ? "-" : ""}£${pounds}${p ? `.${String(p).padStart(2, "0")}` : ""}`;
};

class Story {
  project: Project;
  readonly sc: Scenario;
  readonly settings: PilotSettings;
  readonly facts: Omit<ReadinessContext, "today" | "settings">;

  constructor(sc: Scenario, project: Project, settings: PilotSettings) {
    this.sc = sc;
    this.project = project;
    this.settings = settings;
    this.facts = { compliance: [], crew: [], openIssues: [] };
  }

  ctx(nowIso: string, actor?: StaffMember): ReadinessContext {
    return { today: nowIso.slice(0, 10), settings: this.settings, ...this.facts, ...(actor ? { actor } : {}) };
  }

  /** Apply one action through the real reducer; a refusal is a bug in the demo story. */
  act(action: ProjectAction, nowIso: string, actor?: StaffMember): void {
    const result = applyProjectAction(this.project, action, nowIso, this.ctx(nowIso, actor));
    if (!result.ok) {
      const detail = result.blockers?.filter((b) => b.severity === "block").map((b) => b.code).join(", ");
      throw new DemoSeedError(`${this.sc.label}: ${action.type} at ${nowIso} refused: ${result.error}${detail ? ` [${detail}]` : ""}`);
    }
    this.project = result.project;
  }
}

/* ------------------------------------------------------------------ */
/* Builders for the records                                            */
/* ------------------------------------------------------------------ */

function selfSurvey(sc: Scenario): Survey {
  return {
    postcode: sc.customer.postcode,
    addressLine: sc.customer.addressLine,
    property: { type: sc.house.type, era: sc.house.era, bedrooms: sc.house.bedrooms, ownership: "owner" },
    rooms: sc.rooms.map((r) => ({
      id: `${sc.key}-${r.key}`,
      name: r.name,
      type: r.type,
      size: r.size,
      floor: r.floor,
      glazing: r.glazing,
      orientation: r.orientation,
      // The customer thought every room had an outside wall; the survey says otherwise for DEMO 4.
      hasExternalWall: true,
      photos: [],
    })),
    outdoor: { location: sc.systems[0]!.position.location, photos: [] },
    electrics: { condition: "modern-spare-ways", photos: [] },
  };
}

interface PhotoPlan {
  key: string;
  scene: DemoScene;
  tag: PhotoTag;
  room: string;
  roomId?: string;
  variant?: number;
  unitLabel?: string;
  routeLabel?: string;
  plain?: boolean;
  source: MediaItem["source"];
  takenBy: MediaItem["takenBy"];
  takenAt: string;
  customerVisible: boolean;
  locked?: boolean;
  caption?: string;
}

function photo(projectId: string, sc: Scenario, plan: PhotoPlan): DemoMedia {
  const drawn = demoPhoto({
    scene: plan.scene,
    room: plan.room,
    tag: plan.tag,
    variant: plan.variant,
    unitLabel: plan.unitLabel,
    routeLabel: plan.routeLabel,
    plain: plan.plain,
  });
  const id = demoId(`${sc.key}:media:${plan.key}`);
  const fileName = `demo-${sc.key}-${plan.key}.svg`;
  return {
    fileName,
    svg: drawn.svg,
    item: {
      id,
      projectId,
      bucket: "project-media",
      storagePath: `${projectId}/${id}-${fileName}`,
      contentType: "image/svg+xml",
      tag: plan.tag,
      ...(plan.roomId ? { roomId: plan.roomId } : {}),
      caption: plan.caption ?? drawn.title,
      source: plan.source,
      ...(plan.takenBy ? { takenBy: plan.takenBy } : {}),
      takenAt: plan.takenAt,
      customerVisible: plan.customerVisible,
      width: DEMO_PHOTO_WIDTH,
      height: DEMO_PHOTO_HEIGHT,
      annotations: drawn.annotations,
      annotationsVersion: drawn.annotations.length ? 1 : 0,
      locked: plan.locked === true,
    },
  };
}

const kwOf = (itemId: string) => demoItem(itemId).specs?.coolingKw ?? 0;

function measuredSurvey(sc: Scenario, media: { rooms: Record<string, string[]>; outdoor: Record<string, string>; fuse: string }): MeasuredSurvey {
  return {
    version: 1,
    site: {
      confirmedAddress: true,
      decisionMaker: sc.customer.signName,
      ownerConfirmed: true,
      tenure: "owner",
      accessNotes: sc.access.accessNotes,
      parkingNotes: sc.access.parkingNotes,
      siteContactPhone: sc.customer.phone,
    },
    wishes: sc.wishes,
    house: {
      type: sc.house.type,
      era: sc.house.era,
      wallConstruction: sc.house.wallConstruction,
      storeys: sc.house.storeys,
      loftAccess: true,
      listedOrConservation: sc.house.listedOrConservation,
      asbestosRisk: sc.house.asbestosRisk,
      ...(sc.house.asbestosNote ? { asbestosNote: sc.house.asbestosNote } : {}),
    },
    rooms: sc.rooms.map((r) => ({
      id: r.key,
      name: r.name,
      type: r.type,
      floor: r.floor,
      include: true,
      lengthM: r.lengthM,
      widthM: r.widthM,
      areaM2: round1(r.lengthM * r.widthM),
      ceilingHeightM: r.floor === "loft" ? 2.2 : 2.4,
      glazing: r.glazing,
      orientation: r.orientation,
      occupancy: "normal",
      hasExternalWall: r.hasExternalWall,
      wallConstruction: sc.house.wallConstruction,
      pipeRunM: r.pipeRunM,
      heightDropM: r.heightDropM,
      route: r.route,
      ...(r.routeNote ? { routeNote: r.routeNote } : {}),
      condensate: r.condensate,
      ...(r.condensate === "pump" ? { condensateNote: "No fall to an outside wall: mini pump in the trunking (DEMO)." } : {}),
      mediaIds: media.rooms[r.key] ?? [],
      selfSurveyRoomId: `${sc.key}-${r.key}`,
    })),
    outdoor: {
      positions: sc.systems.map((s) => ({
        id: `o-${s.key}`,
        ...s.position,
        ...(media.outdoor[s.key] ? { mediaId: media.outdoor[s.key] } : {}),
        heightM: 0,
        defrostDrainage: "Gravel strip to the nearest gully (DEMO).",
        chosen: true,
      })),
    },
    electrics: {
      boardType: "modern-rcbo",
      spareWays: 2,
      earthing: "TN-C-S",
      cableRouteM: 9,
      cableRouteNote: "Under-stairs board, cable through the kitchen ceiling void to the rear wall (DEMO).",
      asbestosFlashGuard: "no",
      mediaIds: [media.fuse],
    },
    permissions: {
      pd: {
        "heating-use": "yes",
        "not-listed": "yes",
        "not-conservation-front": sc.house.listedOrConservation === "unknown" ? "unsure" : "yes",
        "volume-ok": "yes",
        "unit-count-ok": "yes",
        "noise-ok": "yes",
        "siting-minimises-impact": "yes",
        "article4-checked": "yes",
      },
      notes: "Rear positions only (DEMO).",
    },
    risks: {
      workingAtHeight: sc.systems.some((s) => s.position.accessEquipment === "tower"),
      structuralConcern: false,
      concealedServicesConcern: sc.rooms.some((r) => r.route === "via-loft"),
    },
    assumptions: ["Existing board has room for a new RCBO (DEMO).", "Customer clears furniture from the unit walls (DEMO)."],
    unknowns: sc.stop === "design-review" ? ["Loft insulation sample result (DEMO)."] : [],
  };
}

function rules(sc: Scenario, review: boolean): RuleResult[] {
  const multi = sc.systems.some((s) => s.roomKeys.length > 1);
  return [
    { id: "topology", title: "System topology", status: "pass", detail: multi ? "Multi-split on a verified combination (DEMO table)." : "One room, one single split." },
    {
      id: "pipe-limits",
      title: "Pipe length & height limits",
      status: review ? "review" : "pass",
      detail: review
        ? "15 m via the loft with an 8 m rise: inside the unit's limits, but past the pre-charge and through a loft with a possible asbestos bay. Needs the technical lead."
        : "Every run is inside the outdoor unit's length and height limits.",
    },
    { id: "electrics", title: "Electrical spare capacity", status: "pass", detail: "Modern RCBO board with two spare ways." },
    {
      id: "planning",
      title: "Planning constraints",
      status: sc.house.listedOrConservation === "unknown" ? "review" : "pass",
      detail: sc.house.listedOrConservation === "unknown" ? "Front elevation may face a conservation area: rear position only." : "No listing, conservation area or Article 4 on record (DEMO).",
    },
    {
      id: "drainage",
      title: "Condensate drainage",
      status: sc.rooms.some((r) => r.condensate === "pump") ? "review" : "pass",
      detail: sc.rooms.some((r) => r.condensate === "pump") ? "One room needs a condensate pump." : "Every unit drains by gravity.",
    },
    { id: "mounting", title: "Indoor unit mounting", status: review ? "review" : "pass", detail: review ? "Main bedroom unit is on an internal wall: the route goes via the loft." : "Every unit is on an outside wall." },
    { id: "clearances", title: "Service clearances", status: "pass", detail: "Standard 300 mm rear, 600 mm front clearances." },
    { id: "noise", title: "Noise at nearest neighbour", status: "pass", detail: "Estimated 36 dB(A) at the nearest neighbouring window, inside the 42 dB(A) guidance (DEMO)." },
  ];
}

function variantFor(sc: Scenario, tier: "standard" | "premium", review: boolean): DesignVariant {
  const premium = tier === "premium";
  const indoorOf = (r: RoomSpec) => (premium && r.prem ? r.prem : r.std);
  const roomByKey = new Map(sc.rooms.map((r) => [r.key, r]));
  const systems = sc.systems.map((s) => {
    const outdoorId = premium && s.prem ? s.prem : s.std;
    const outdoor = demoItem(outdoorId);
    const totalPipeM = sum(s.roomKeys.map((k) => roomByKey.get(k)!.pipeRunM));
    const precharged = outdoor.specs?.prechargedPipeM ?? 15;
    const perM = outdoor.specs?.additionalChargeGPerM ?? 20;
    return {
      id: s.key,
      topology: s.roomKeys.length > 1 ? ("multi" as const) : ("single" as const),
      outdoorItemId: outdoorId,
      roomIds: s.roomKeys,
      outdoorPositionId: `o-${s.key}`,
      compatibility: { ok: true, errors: [], warnings: review ? ["Run past the pre-charge: add refrigerant on site."] : [] },
      electrical: {
        breaker: (outdoor.specs?.recommendedBreakerA ?? 16) > 16 ? "20 A Type C RCBO" : "16 A Type C RCBO",
        cableMm2: 2.5,
        isolator: "20 A rotary isolator by the outdoor unit",
        routeNote: "From the under-stairs board through the kitchen ceiling void (DEMO).",
      },
      refrigerant: { totalPipeM, prechargedPipeM: precharged, additionalChargeG: Math.max(0, totalPipeM - precharged) * perM },
    };
  });
  const roomUnits = sc.rooms.map((r) => ({ roomId: r.key, indoorItemId: indoorOf(r) }));
  const bomLine = (id: string, qty: number, category: DesignBomLine["category"]): DesignBomLine => {
    const it = demoItem(id);
    return { catalogueItemId: id, sku: it.model ?? id, label: it.label, qty, ...(it.unit ? { unit: it.unit } : {}), category };
  };
  const pipeM = sum(sc.rooms.map((r) => r.pipeRunM + 1));
  const bom: DesignBomLine[] = [
    ...roomUnits.map((u) => bomLine(u.indoorItemId, 1, "equipment")),
    ...systems.map((s) => bomLine(s.outdoorItemId, 1, "equipment")),
    bomLine("demo-mat-lineset", pipeM, "materials"),
    bomLine("demo-mat-trunking", Math.ceil(pipeM / 2), "materials"),
    ...sc.systems.map((s) => bomLine(s.position.base === "wall-bracket" ? "demo-mat-bracket" : "demo-mat-feet", 1, "materials")),
    bomLine("demo-mat-cable", 9 * sc.systems.length, "materials"),
    bomLine("demo-mat-rcbo", sc.systems.length, "materials"),
    bomLine("demo-mat-isolator", sc.systems.length, "materials"),
    bomLine("demo-mat-condensate", sc.rooms.length, "materials"),
    bomLine("demo-mat-sleeve", sc.rooms.length, "materials"),
    bomLine("demo-mat-fixings", 1, "consumables"),
  ];
  const ruleList = rules(sc, review);
  return {
    id: `${sc.key}-${tier}`,
    label: premium ? "Quiet" : "Standard",
    tier,
    systems,
    roomUnits,
    bom,
    rules: ruleList,
    verdict: designVerdict(ruleList),
    installDays: 3,
  };
}

function labourFor(sc: Scenario): LabourPlan {
  return { crewSize: 2, installerDays: 3, electricianDays: sc.systems.length > 1 ? 1.5 : 1, techLeadDays: 3 };
}

/** Cost build-up from the DEMO catalogue and the labour rates in settings. All provisional. */
function costLinesFor(sc: Scenario, variant: DesignVariant, labour: LabourPlan, settings: PilotSettings): CostLine[] {
  const lines: CostLine[] = [];
  let n = 0;
  const add = (category: CostLine["category"], label: string, qty: number, unit: string, unitCostPence: number, catalogueItemId?: string) => {
    n += 1;
    lines.push({
      id: `${variant.id}-c${n}`,
      category,
      label,
      qty,
      unit,
      unitCostPence,
      totalPence: Math.round(qty * unitCostPence),
      source: catalogueItemId ? "DEMO catalogue (provisional)" : "DEMO settings",
      ...(catalogueItemId ? { catalogueItemId } : {}),
      verified: false,
    });
  };
  for (const line of variant.bom) {
    if (!line.catalogueItemId) continue;
    const it = demoItem(line.catalogueItemId);
    add(line.category === "equipment" ? "equipment" : "materials", it.label, line.qty, it.unit ?? "each", it.costPence ?? 0, it.id);
  }
  const rates = settings.pricing.labourRates;
  add("labour", "Installer", labour.installerDays, "day", rates.installerDayPence);
  add("labour", "Technical lead (F-gas)", labour.techLeadDays, "day", rates.techLeadDayPence);
  add("labour", "Electrician (Part P)", labour.electricianDays, "day", rates.electricianDayPence);
  if (sc.systems.some((s) => s.position.accessEquipment === "tower")) add("access", "Tower hire, one week (DEMO)", 1, "week", 9_500);
  add("delivery", "Kit delivery (DEMO)", 1, "drop", 2_500);
  add("consumables", "Sealant, fixings and tape (DEMO)", 1, "kit", 3_500);
  const subtotal = sum(lines.map((l) => l.totalPence ?? 0));
  add("contingency", `Contingency (${settings.pricing.contingencyPct}%)`, 1, "job", Math.round((subtotal * settings.pricing.contingencyPct) / 100));
  if (settings.pricing.overheadPerJobPence > 0) add("overhead", "Overhead per job", 1, "job", settings.pricing.overheadPerJobPence);
  return lines;
}

/**
 * Cost-plus pricing to a 30% gross margin after the pilot discount: the
 * list price is set so the discounted price still clears the minimum.
 * (F4's priceOption is the real engine; this is the DEMO stand-in.)
 */
function pricingFor(costLines: CostLine[], settings: PilotSettings, discountCode: string | undefined): OptionPricing {
  const cost = sum(costLines.map((l) => l.totalPence ?? 0));
  const discount = settings.discounts.find((d) => d.code === discountCode && d.active);
  const pct = discount?.pct ?? 0;
  const list = Math.ceil(cost / ((1 - 0.3) * (1 - pct / 100)) / 1000) * 1000; // to the £10
  const discountPence = Math.round((list * pct) / 100);
  const net = list - discountPence;
  const taxCode = effectiveTaxCode(settings);
  const taxPence = Math.round((net * TAX_CODES[taxCode].ratePct) / 100);
  const margin = (price: number) => round1(((price - cost) / price) * 100);
  return {
    pricingBasis: "cost-plus",
    listNetPence: list,
    ...(discount ? { discount: { code: discount.code, label: discount.label, reason: discount.reason, amountPence: discountPence } } : {}),
    netPence: net,
    taxCode,
    taxPence,
    totalPence: net + taxPence,
    costPence: cost,
    unpricedCostLines: costLines.filter((l) => l.unitCostPence === null).length,
    grossMarginPct: margin(net),
    grossMarginPctBeforeDiscount: margin(list),
    contributionPence: net - cost,
    belowMinMargin: margin(net) < settings.pricing.minMarginPct,
  };
}

function priceLinesFor(sc: Scenario, variant: DesignVariant, pricing: OptionPricing): PriceLine[] {
  // The list price split across systems by their equipment cost; the last takes the rounding.
  const equipment = variant.systems.map((s) => {
    const rooms = variant.roomUnits.filter((u) => s.roomIds.includes(u.roomId));
    return (demoItem(s.outdoorItemId).costPence ?? 0) + sum(rooms.map((u) => demoItem(u.indoorItemId).costPence ?? 0));
  });
  const total = sum(equipment) || 1;
  let left = pricing.listNetPence;
  const lines: PriceLine[] = variant.systems.map((s, i) => {
    const amount = i === variant.systems.length - 1 ? left : Math.round((pricing.listNetPence * equipment[i]!) / total);
    left -= amount;
    const names = s.roomIds.map((id) => sc.rooms.find((r) => r.key === id)!.name);
    return {
      id: `${variant.id}-p${i + 1}`,
      label: `${names.join(", ")}: supply and install`,
      detail: `${demoItem(s.outdoorItemId).label} with ${s.roomIds.length} indoor unit${s.roomIds.length === 1 ? "" : "s"}, pipework, electrics and commissioning`,
      amountPence: amount,
      kind: "system",
    };
  });
  if (pricing.discount) {
    lines.push({ id: `${variant.id}-disc`, label: pricing.discount.label, detail: pricing.discount.reason, amountPence: -pricing.discount.amountPence, kind: "discount" });
  }
  if (pricing.taxPence > 0) {
    lines.push({ id: `${variant.id}-vat`, label: TAX_CODES[pricing.taxCode].label, amountPence: pricing.taxPence, kind: "fee" });
  }
  return lines;
}

function optionFor(
  sc: Scenario,
  variant: DesignVariant,
  settings: PilotSettings,
  media: { rooms: Record<string, string[]>; outdoor: Record<string, string> },
): ProposalOption {
  const labour = labourFor(sc);
  const costLines = costLinesFor(sc, variant, labour, settings);
  const pricing = pricingFor(costLines, settings, sc.discountCode);
  const quiet = variant.tier === "premium";
  return {
    id: `${variant.id}-option`,
    label: variant.label,
    tier: variant.tier,
    designVariantId: variant.id,
    summary: quiet
      ? "Our quietest units in every room, with app control and purifying filters."
      : "Efficient, quiet units sized to each room, heating and cooling.",
    highlights: quiet ? ["19 dB on the quietest setting", "App control included", "Purifying filters"] : ["Heats and cools", "App control included", "Three-day install"],
    roomCards: sc.rooms.map((r) => {
      const unit = demoItem(variant.roomUnits.find((u) => u.roomId === r.key)!.indoorItemId);
      return {
        roomId: r.key,
        roomName: r.name,
        unitName: unit.label,
        why: `Sized at ${unit.specs?.coolingKw ?? "?"} kW for a ${round1(r.lengthM * r.widthM)} m² ${r.orientation}-facing room, with room to spare on hot afternoons.`,
        highlights: [`${unit.specs?.soundPressureLowDb ?? "?"} dB on its quietest setting`, "Heats as well as cools"],
        mediaIds: media.rooms[r.key] ?? [],
        pipeNote: pipeNoteFor({ pipeRunM: r.pipeRunM, heightDiffM: r.heightDropM, condensate: r.condensate }, { route: r.route, ...(r.routeNote ? { routeNote: r.routeNote } : {}) }),
      };
    }),
    outdoorMediaIds: Object.values(media.outdoor),
    priceLines: priceLinesFor(sc, variant, pricing),
    costLines,
    labour,
    pricing,
    installDays: 3,
  };
}

const INCLUSIONS = [
  "Every unit, the outdoor unit and all pipework, cable and fittings",
  "A new dedicated circuit, tested and certified by a Part P electrician",
  "Commissioning by an F-gas certified engineer, with the readings in your handover pack",
  "Making good around every hole we drill, and taking the packaging away",
];
const EXCLUSIONS = ["Redecorating after the install", "Moving furniture larger than one person can lift", "Any building work not listed above"];
const ASSUMPTIONS = ["Your fuse board has the spare way the survey found", "Clear access to each unit wall on the day"];

/** Customer-safe view: F4's rule (no costs, margins or overrides). */
const customerSafe = (p: ProposalRecord): ProposalRecord => customerSafeProposal(p);

/* ------------------------------------------------------------------ */
/* One project                                                         */
/* ------------------------------------------------------------------ */

const DEMO_GPS = { lat: 51.44, lng: -0.14 };

/** Readings for the runsheet's numeric slots, by label: comfortably inside every window. */
const READINGS: [RegExp, number][] = [
  [/Clearance below ceiling/, 160],
  [/Drain fall/, 25],
  [/Core diameter/, 65],
  [/Fall through the wall/, 5],
  [/Gas flare torque/, 37],
  [/Rear service clearance/, 300],
  [/neighbouring window/, 4.5],
  [/clip spacing/, 800],
  [/Terminal torque/, 2],
  [/Earth continuity/, 0.21],
  [/Test pressure applied/, 41.5],
  [/Pressure after/, 41.4],
  [/Vacuum achieved/, 350],
  [/decay hold/, 480],
  [/Noise at the boundary/, 38],
];

/** Pilot runsheet fields on top of the demo template: which day, who may record, what's critical. */
function decorateRunsheet(steps: InstallStep[]): InstallStep[] {
  return steps.map((s) => {
    const day: 1 | 2 | 3 = s.phase <= 3 ? 1 : s.phase <= 6 ? 2 : 3;
    const requires = s.phase === 7 ? ("electrical" as const) : s.phase >= 8 && s.phase <= 10 ? ("fgas" as const) : undefined;
    return { ...s, day, ...(requires ? { requires } : {}), ...(s.phase === 8 || s.phase === 9 ? { critical: true } : {}) };
  });
}

function buildProject(sc: Scenario, today: string, settings: PilotSettings, invoiceCounter: { n: number }): DemoProject {
  const projectId = demoId(`${sc.key}:project`);
  const quoteId = demoId(`${sc.key}:quote`);
  const customerId = demoId(`${sc.key}:customer`);
  const id = (k: string) => demoId(`${sc.key}:${k}`);
  const survey = selfSurvey(sc);
  const quote = generateQuote(survey);
  const stops: Stop[] = ["survey-booked", "design-review", "proposal-issued", "ready-to-install", "closed"];
  const reaches = (s: Stop) => stops.indexOf(sc.stop) >= stops.indexOf(s);
  // Survey-day times are written for a 10:00 slot; later slots shift them.
  const shift = (sc.surveyHour ?? 10) - 10;
  const sv = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return `${String(h + shift).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  /* ---------------- calendar ---------------- */

  // Built backwards from where each story ends, so every step is in the past.
  const cal: Record<string, string> = {};
  if (sc.stop === "closed") {
    // Handed over ten days ago; the kit arrived early enough that the
    // cancellation period (14 days from delivery) ended before day 1.
    const days = workingDaysEnding(addDays(today, -10), 3);
    [cal.d1, cal.d2, cal.d3] = days as [string, string, string];
    cal.kitDelivered = prevWorkingDay(addDays(cal.d1!, -17));
  } else if (sc.stop === "ready-to-install") {
    const days = workingDaysFrom(addDays(today, 7), 3);
    [cal.d1, cal.d2, cal.d3] = days as [string, string, string];
    cal.kitInspected = prevWorkingDay(addDays(today, -2));
    cal.kitDelivered = prevWorkingDay(addDays(cal.kitInspected, -1));
  }
  if (cal.kitDelivered) {
    // Each step a working day before the next: confirmed, ordered, booked, evidenced, accepted.
    cal.kitConfirmed = prevWorkingDay(addDays(cal.kitDelivered, -2));
    cal.kitOrdered = prevWorkingDay(addDays(cal.kitConfirmed, -1));
    cal.booked = prevWorkingDay(addDays(cal.kitOrdered, -1));
    cal.depositPaid = cal.booked;
    cal.evidenced = prevWorkingDay(addDays(cal.depositPaid, -1));
    cal.accepted = prevWorkingDay(addDays(cal.evidenced, -1));
    cal.issued = prevWorkingDay(addDays(cal.accepted, -3));
  } else if (sc.stop === "proposal-issued") {
    cal.issued = prevWorkingDay(addDays(today, -3));
  }
  if (cal.issued) {
    cal.approved = prevWorkingDay(addDays(cal.issued, -1));
    cal.review = prevWorkingDay(addDays(cal.approved, -1));
  } else if (sc.stop === "design-review") {
    cal.review = prevWorkingDay(addDays(today, -4));
  }
  if (cal.review) {
    cal.draft = prevWorkingDay(addDays(cal.review, -1));
    cal.survey = prevWorkingDay(addDays(cal.draft, -2));
    cal.surveyBooked = addDays(cal.survey, -6);
  } else {
    cal.survey = nextWorkingDay(addDays(today, 3)); // DEMO 1: three days out
    cal.surveyBooked = addDays(today, -1);
  }
  cal.created = addDays(cal.surveyBooked, -1);

  /* ---------------- quote, customer, project ---------------- */

  const quoteRow: DemoQuoteRow = {
    id: quoteId,
    created_at: at(cal.created, "18:05"),
    customer_name: sc.customer.name,
    email: sc.customer.email,
    phone: sc.customer.phone,
    timeframe: "1-3-months",
    postcode: survey.postcode,
    address_line: survey.addressLine,
    engine_version: quote.engineVersion,
    survey,
    quote,
    total_gbp: quote.totalGbp,
    room_count: survey.rooms.length,
    confidence_score: quote.confidence.score,
    confidence_band: quote.confidence.band,
    status: "booked",
    source: "demo",
  };
  const customer: DemoCustomer = { id: customerId, email: sc.customer.email, name: sc.customer.name, phone: sc.customer.phone, createdAt: at(cal.created, "18:05") };

  const created = createProject({
    id: projectId,
    quoteId,
    createdAt: at(cal.created, "18:06"),
    customerName: sc.customer.name,
    survey,
    quote,
    customerEmail: sc.customer.email,
    customerPhone: sc.customer.phone,
    customerId,
    surveyFeeGbp: 0,
    surveyDurationMinutes: settings.scheduling.surveyDurationMinutes,
    installDays: settings.scheduling.installBlockDays,
  });
  const story = new Story(sc, created, settings);

  const out: DemoProject = {
    n: sc.n,
    key: sc.key,
    label: sc.label,
    quote: quoteRow,
    customer,
    project: created,
    compliance: [],
    purchaseOrders: [],
    evidence: [],
    issues: [],
    time: [],
    invoices: [],
    payments: [],
    messages: [],
    documents: [],
    learnings: [],
    media: [],
    ctx: story.ctx(at(today, "00:00")),
  };

  const message = (
    event: CommsEventId,
    channel: "email" | "sms",
    discriminator: string,
    createdAt: string,
    subject: string,
    body: string,
  ) => {
    out.messages.push({
      id: id(`message:${event}:${discriminator}:${channel}`),
      idempotencyKey: idempotencyKey(event, projectId, discriminator, channel),
      projectId,
      event,
      channel,
      templateVersion: COMMS_EVENTS[event].templateVersion,
      to: channel === "email" ? sc.customer.email : sc.customer.phone,
      ...(channel === "email" ? { subject } : {}),
      bodyText: `${body}\n\n(DEMO: stored, never sent.)`,
      status: "demo",
      provider: "demo",
      attempts: 0,
      createdAt,
    });
  };
  const timeEntry = (kind: TimeEntry["kind"], who: StaffMember, startedAt: string, minutes: number, dayN?: number, note?: string) => {
    const endedAt = new Date(Date.parse(startedAt) + minutes * 60_000).toISOString();
    out.time.push({
      id: id(`time:${kind}:${who.id}:${startedAt}`),
      projectId,
      staffId: who.id,
      staffName: who.name,
      kind,
      ...(dayN ? { dayN } : {}),
      startedAt,
      endedAt,
      minutes,
      ...(note ? { note } : {}),
    });
  };
  const docs: DocumentRecord[] = [];
  const document = <K extends DocumentKind>(
    kind: K,
    key: string,
    title: string,
    createdAt: string,
    snapshot: DocumentSnapshots[K],
  ): DemoDocument<K> => {
    // The same planner createDocument uses, so the refs planned here are the refs it assigns.
    const plan = planDocument({ existing: docs, projectId, kind, instance: documentInstance(kind, snapshot), status: "final" });
    const doc: DemoDocument<K> = {
      id: id(`document:${key}`),
      kind,
      title,
      customerVisible: true,
      createdBy: ADMIN.name,
      createdAt,
      snapshot,
      ref: plan.ref,
      version: plan.version,
    };
    for (const old of plan.supersede) old.status = "superseded";
    docs.push({ id: doc.id, projectId, kind, version: plan.version, ref: plan.ref, title, status: "final", customerVisible: true, snapshot, createdAt });
    out.documents.push(doc as DemoDocument);
    return doc;
  };
  const header = (issuedAt: string) => ({ company: documentCompany(settings), customer: documentCustomer(story.project), issuedAt });

  /* ---------------- price → survey booked ---------------- */

  story.act({ type: "set-pilot", number: 900 + sc.n, label: sc.label }, at(cal.created, "18:07"), ADMIN);
  story.act({ type: "set-owner", staffId: ADMIN.id, name: ADMIN.name }, at(cal.created, "18:08"), ADMIN);
  const surveySlot = at(cal.survey, sv("10:00"));
  story.act({ type: "book-survey", scheduledFor: surveySlot, mode: "in-person" }, at(cal.surveyBooked, "19:40"));
  if (sc.stop === "survey-booked") {
    story.act({ type: "set-customer-contact", accessNotes: sc.access.accessNotes, parkingNotes: sc.access.parkingNotes }, at(cal.surveyBooked, "19:42"));
  }
  story.act({ type: "assign-surveyor", staffId: SURVEYOR.id, name: SURVEYOR.name }, at(cal.surveyBooked, "19:55"), ADMIN);
  message("survey-booked", "email", surveySlot, at(cal.surveyBooked, "19:41"), "Your home survey is booked", `Hi ${sc.customer.signName}, your home survey at ${sc.customer.addressLine} is booked for ${cal.survey} at ${sv("10:00")}. ${SURVEYOR.name} will spend about 90 minutes with you.`);

  if (sc.stop === "survey-booked") {
    // The customer's own photo from the funnel's "lock your price" step.
    out.media.push(
      photo(projectId, sc, {
        key: "customer-outdoor",
        scene: "outdoor",
        tag: "outdoor-location",
        room: "Garden",
        plain: true,
        source: "customer",
        takenBy: { kind: "customer", name: sc.customer.name },
        takenAt: at(cal.created, "18:03"),
        customerVisible: true,
        caption: "Where I'd like the outdoor unit (customer photo, DEMO)",
      }),
    );
    story.act(
      { type: "set-next-action", text: "Survey: check side access for the outdoor spot", dueOn: cal.survey, ownerRole: "surveyor" },
      at(cal.surveyBooked, "20:00"),
      ADMIN,
    );
    out.compliance = demoChecklist(projectId, (k) => id(`compliance:${k}`), {});
    story.facts.compliance = out.compliance.map(complianceView);
    return finish(out, story, today);
  }

  /* ---------------- survey ---------------- */

  const surveyorBy = { kind: "staff" as const, id: SURVEYOR.id, name: SURVEYOR.name };
  const approvedLayout = reaches("proposal-issued");
  const roomMedia: Record<string, string[]> = {};
  const outdoorMedia: Record<string, string> = {};
  sc.rooms.forEach((r, i) => {
    const unit = demoItem(r.std);
    const wall = photo(projectId, sc, {
      key: `survey-${r.key}-wall`,
      scene: "indoor-wall",
      tag: "indoor-wall",
      room: r.name,
      roomId: r.key,
      variant: i,
      unitLabel: `Indoor unit · ${unit.specs?.coolingKw ?? ""} kW`,
      routeLabel: r.route === "via-loft" ? "Pipe up into the loft" : r.route === "through-wall" ? "Pipe out, 0.4 m" : `Pipe out, then ${r.pipeRunM} m`,
      source: "survey",
      takenBy: surveyorBy,
      takenAt: at(cal.survey, sv(`10:${String(15 + i * 12).padStart(2, "0")}`)),
      customerVisible: true,
      locked: approvedLayout,
    });
    out.media.push(wall);
    roomMedia[r.key] = [wall.item.id];
    if (i === 0) {
      const overview = photo(projectId, sc, {
        key: `survey-${r.key}-overview`,
        scene: "room-overview",
        tag: "room-overview",
        room: r.name,
        roomId: r.key,
        variant: i + 1,
        plain: true,
        source: "survey",
        takenBy: surveyorBy,
        takenAt: at(cal.survey, sv("10:12")),
        customerVisible: true,
      });
      out.media.push(overview);
      roomMedia[r.key]!.push(overview.item.id);
    }
  });
  sc.systems.forEach((s, i) => {
    const pipe = sum(s.roomKeys.map((k) => sc.rooms.find((r) => r.key === k)!.pipeRunM));
    const shot = photo(projectId, sc, {
      key: `survey-${s.key}-outdoor`,
      scene: "outdoor",
      tag: "outdoor-location",
      room: s.position.label.split(",")[0]!,
      variant: i,
      unitLabel: `Outdoor unit · ${demoItem(s.std).specs?.coolingKw ?? ""} kW`,
      routeLabel: `Pipe route ${pipe} m`,
      source: "survey",
      takenBy: surveyorBy,
      takenAt: at(cal.survey, sv(`11:${String(5 + i * 8).padStart(2, "0")}`)),
      customerVisible: true,
      locked: approvedLayout,
    });
    out.media.push(shot);
    outdoorMedia[s.key] = shot.item.id;
  });
  const fuse = photo(projectId, sc, {
    key: "survey-fuse-board",
    scene: "fuse-board",
    tag: "fuse-board",
    room: "Under the stairs",
    source: "survey",
    takenBy: surveyorBy,
    takenAt: at(cal.survey, sv("11:25")),
    customerVisible: true,
  });
  out.media.push(fuse);
  if (sc.rooms.some((r) => r.route === "via-loft")) {
    const loftShot = photo(projectId, sc, {
      key: "survey-loft-route",
      scene: "loft",
      tag: "pipe-route",
      room: "Loft",
      routeLabel: "Pipe route via loft, 9 m",
      source: "survey",
      takenBy: surveyorBy,
      takenAt: at(cal.survey, sv("10:58")),
      customerVisible: true,
    });
    out.media.push(loftShot);
    const loftRoom = sc.rooms.find((r) => r.route === "via-loft")!;
    roomMedia[loftRoom.key] = [...(roomMedia[loftRoom.key] ?? []), loftShot.item.id];
  }

  const measured = measuredSurvey(sc, { rooms: roomMedia, outdoor: outdoorMedia, fuse: fuse.item.id });
  const surveyRecord: SurveyRecord = {
    id: id("survey:1"),
    projectId,
    version: 1,
    status: "submitted",
    data: measured,
    surveyor: { staffId: SURVEYOR.id, name: SURVEYOR.name },
    startedAt: at(cal.survey, sv("10:04")),
    submittedAt: at(cal.survey, sv("11:52")),
    minutes: 108,
  };
  out.survey = surveyRecord;

  story.facts.surveyCompleteness = { pct: 100, missing: [] };
  story.act({ type: "surveyor-on-my-way", etaMinutes: 20, by: SURVEYOR.name }, at(cal.survey, sv("09:38")), SURVEYOR);
  message("surveyor-on-my-way", "sms", `${surveySlot}`, at(cal.survey, sv("09:38")), "", `${SURVEYOR.name} from Dang, It's Hot is on the way to your survey, about 20 minutes out.`);
  story.act({ type: "survey-started", by: SURVEYOR.name }, at(cal.survey, sv("10:04")), SURVEYOR);
  story.act(
    {
      type: "survey-submitted",
      surveyRecordId: surveyRecord.id,
      electrics: { status: "validated", summary: "Modern RCBO board with two spare ways: the new circuit drops straight in." },
    },
    at(cal.survey, sv("11:52")),
    SURVEYOR,
  );
  message("survey-complete", "email", surveyRecord.id, at(cal.survey, sv("11:53")), "Thanks for having us", `Hi ${sc.customer.signName}, your survey is done. Your design and proposal are next.`);
  story.act({ type: "set-customer-contact", accessNotes: sc.access.accessNotes, parkingNotes: sc.access.parkingNotes }, at(cal.survey, sv("11:54")), SURVEYOR);
  timeEntry("travel", SURVEYOR, at(cal.survey, sv("09:20")), 40, undefined, "To the survey");
  timeEntry("survey", SURVEYOR, at(cal.survey, sv("10:04")), 108);
  document("survey-report", "survey-report", "Your survey report", at(cal.survey, sv("12:10")), {
    ...header(at(cal.survey, sv("12:10"))),
    survey: surveyRecord,
    promises: [
      `Your design and proposal arrive by ${fmtDate(workingDaysFrom(addDays(cal.survey, 1), PROPOSAL_TURNAROUND_WORKING_DAYS).at(-1)!)}.`,
      "A qualified engineer checks the design before you see a price.",
    ],
  });

  /* ---------------- design ---------------- */

  const inReview = sc.stop === "design-review";
  const variants = [variantFor(sc, "standard", inReview), ...(sc.premium ? [variantFor(sc, "premium", inReview)] : [])];
  const roomLoad = new Map(quote.systems.flatMap((s) => s.rooms).map((r) => [r.roomName, r]));
  const design: DesignRecord = {
    id: id("design:1"),
    projectId,
    version: 1,
    status: inReview ? "in-review" : "approved",
    surveyRecordId: surveyRecord.id,
    rooms: sc.rooms.map((r) => {
      const engine = roomLoad.get(r.name);
      const chosenKw = kwOf(r.std);
      const suggestedKw = engine?.capacityKw ?? chosenKw;
      return {
        roomId: r.key,
        roomName: r.name,
        floor: r.floor,
        preliminaryLoadW: engine?.estimatedLoadWatts ?? Math.round(r.lengthM * r.widthM * 110),
        suggestedKw,
        chosenKw,
        ...(chosenKw !== suggestedKw ? { reason: `Measured ${round1(r.lengthM * r.widthM)} m² and ${r.glazing} glazing: ${chosenKw} kW fits the measured room (DEMO).` } : {}),
        pipeRunM: r.pipeRunM,
        heightDiffM: r.heightDropM,
        condensate: r.condensate,
        layoutMediaIds: roomMedia[r.key] ?? [],
      };
    }),
    variants,
    overrides: inReview
      ? [
          {
            field: "rooms.r1.pipeRunM",
            from: "6",
            to: "15",
            reason: "No usable outside wall at the front (conservation area side), so the run goes up through the loft and down the rear gable.",
            by: SURVEYOR.name,
            at: at(cal.review, "09:40"),
          },
        ]
      : [],
    ...(inReview ? { notes: "Loft route needs the technical lead: joists, a possible asbestos bay, and a run past the pre-charge (DEMO)." } : {}),
    ...(inReview ? {} : { approval: { staffId: TECH.id, name: TECH.name, qualificationRef: techRef(), at: at(cal.approved!, "16:30") } }),
    createdAt: at(cal.draft!, "14:00"),
    createdBy: SURVEYOR.name,
  };
  out.design = design;
  story.facts.design = { status: "draft", compatibilityErrors: [] };
  story.act({ type: "design-updated", designId: design.id, version: 1, status: "draft" }, at(cal.draft!, "14:00"), SURVEYOR);
  story.act({ type: "design-updated", designId: design.id, version: 1, status: "in-review" }, at(cal.review!, "10:00"), SURVEYOR);
  timeEntry("design", SURVEYOR, at(cal.draft!, "14:00"), 70);

  if (inReview) {
    const issue: Issue = {
      id: id("issue:1"),
      projectId,
      number: 1,
      kind: "blocker",
      title: "Pipe route through loft needs tech-lead review",
      detail: "15 m via the loft with an 8 m rise, between joists, past a bay of insulation that may be vermiculite. Check the route, the extra charge and whether the asbestos sample is needed first.",
      severity: "high",
      status: "open",
      blocking: true,
      gate: "proposal-issue",
      ownerRole: "tech-lead",
      ownerStaffId: TECH.id,
      ownerName: TECH.name,
      nextAction: "Review the loft route and the override, then approve or send back",
      dueOn: addDays(today, 2),
      raisedBy: { kind: "staff", id: SURVEYOR.id, name: SURVEYOR.name },
      raisedAt: at(cal.review!, "10:05"),
      mediaIds: (roomMedia.r1 ?? []).slice(-1),
      customerVisible: false,
      history: [{ at: at(cal.review!, "10:05"), by: SURVEYOR.name, note: "Raised from the design review.", status: "open" }],
    };
    out.issues.push(issue);
    story.act({ type: "note", text: "Loft route flagged for the technical lead before any proposal (DEMO)." }, at(cal.review!, "10:06"), SURVEYOR);
    story.act(
      { type: "set-next-action", text: "Tech lead: review the loft pipe route", dueOn: addDays(today, 2), ownerRole: "tech-lead" },
      at(cal.review!, "10:07"),
      ADMIN,
    );
    out.compliance = demoChecklist(projectId, (k) => id(`compliance:${k}`), {
      "ownership-authority": approved(SURVEYOR, at(cal.survey, sv("11:50")), "Owner on the title, confirmed at the survey (DEMO)."),
      designations: { status: "under-review", note: "Front elevation may face a conservation area: rear position proposed (DEMO)." },
      asbestos: { status: "evidence-required", note: sc.house.asbestosNote, mediaIds: (roomMedia.r1 ?? []).slice(-1) },
      "planning-pd": { status: "under-review", note: "One permitted-development answer is 'unsure' (DEMO)." },
      "equipment-compatibility": { status: "under-review" },
      "design-approval": { status: "under-review" },
    });
    story.facts.compliance = out.compliance.map(complianceView);
    story.facts.openIssues = [{ id: issue.id, title: issue.title, kind: issue.kind, severity: issue.severity, blocking: true, gate: "proposal-issue" }];
    timeEntry("design", TECH, at(cal.review!, "15:00"), 30, undefined, "First look at the loft route");
    return finish(out, story, today);
  }

  story.facts.design = { status: "approved", approvedBy: TECH.name, compatibilityErrors: [] };
  story.act({ type: "design-approved", designId: design.id, version: 1, by: TECH.name }, at(cal.approved!, "16:30"), TECH);
  timeEntry("design", TECH, at(cal.approved!, "15:30"), 60, undefined, "Design review and sign-off");

  /* ---------------- proposal ---------------- */

  const media = { rooms: roomMedia, outdoor: outdoorMedia };
  const options = variants.map((v) => optionFor(sc, v, settings, media));
  const validUntil = addDays(cal.issued!, settings.pricing.quoteValidityDays);
  const instantPence = quote.totalGbp * 100;
  const dearest = Math.max(...options.map((o) => o.pricing.totalPence));
  const proposal: ProposalRecord = {
    id: id("proposal:1"),
    projectId,
    version: 1,
    status: "issued",
    designId: design.id,
    designVersion: 1,
    options,
    inclusions: INCLUSIONS,
    exclusions: EXCLUSIONS,
    assumptions: ASSUMPTIONS,
    warranty: settings.warranty.manufacturerSummary,
    validUntil,
    termsVersion: settings.legal.termsVersion,
    // Frozen at issue, as the real issue does: the deposit and due days the contract carries.
    terms: proposalTermsFrom(settings),
    instantPriceGbp: quote.totalGbp,
    ...(dearest > instantPence ? { increaseReason: "Your survey measured longer pipe runs and the new circuit's route; the online estimate assumed the simplest case." } : {}),
    issuedAt: at(cal.issued!, "11:00"),
    issuedBy: ADMIN.name,
    viewedAt: at(cal.issued!, "19:12"),
    createdAt: at(cal.issued!, "10:20"),
  };
  story.facts.proposalCheck = {
    belowMinMargin: options.some((o) => o.pricing.belowMinMargin),
    marginOverride: false,
    taxConfirmed: true,
    taxOverride: false,
    expired: false,
  };
  story.act({ type: "documents-consent-recorded", channel: "portal" }, at(cal.approved!, "18:20"));
  story.act(
    { type: "proposal-issued", proposalId: proposal.id, version: 1, validUntil, optionCount: options.length, contractType: "supply-and-install" },
    at(cal.issued!, "11:00"),
    ADMIN,
  );
  message("proposal-issued", "email", `${proposal.id}:v1`, at(cal.issued!, "11:01"), "Your proposal is ready", `Hi ${sc.customer.signName}, your proposal is ready, with ${options.length === 1 ? "one option" : `${options.length} options`}. It's valid until ${validUntil}. It includes your cancellation rights and the model cancellation form.`);
  story.act({ type: "pre-contract-info-sent", proposalId: proposal.id, demo: true }, at(cal.issued!, "11:01"));
  story.act({ type: "proposal-viewed", proposalId: proposal.id }, at(cal.issued!, "19:12"));
  timeEntry("proposal", ADMIN, at(cal.issued!, "10:00"), 50);
  document("proposal", "proposal", "Your proposal", at(cal.issued!, "11:00"), { ...header(at(cal.issued!, "11:00")), proposal: customerSafe(proposal) });

  // The checklist so far: what a proposal can stand on.
  const proposalStage: Partial<Record<string, ChecklistState>> = {
    "ownership-authority": approved(SURVEYOR, at(cal.survey, "11:50"), "Owner on the title, confirmed at the survey (DEMO)."),
    designations: approved(SURVEYOR, at(cal.survey, "11:50"), "No listing, conservation area or Article 4 on record (DEMO)."),
    "manufacturer-requirements": approved(TECH, at(cal.approved!, "16:20")),
    "equipment-compatibility": approved(TECH, at(cal.approved!, "16:20"), "Combination on the DEMO table."),
    "design-approval": approved(TECH, at(cal.approved!, "16:30")),
    "noise-assessment": approved(TECH, at(cal.approved!, "16:10"), "36 dB(A) at the nearest window (DEMO).", Object.values(outdoorMedia)),
    "outdoor-siting": approved(TECH, at(cal.approved!, "16:10"), undefined, Object.values(outdoorMedia)),
    "planning-pd": { status: "under-review", note: "Checklist answered at the survey; tech lead to confirm (DEMO)." },
  };

  if (sc.stop === "proposal-issued") {
    out.proposal = proposal;
    story.act(
      { type: "set-next-action", text: "Chase the proposal decision", dueOn: addDays(today, 3), ownerRole: "admin" },
      at(cal.issued!, "19:30"),
      ADMIN,
    );
    out.compliance = demoChecklist(projectId, (k) => id(`compliance:${k}`), proposalStage);
    story.facts.compliance = out.compliance.map(complianceView);
    return finish(out, story, today);
  }

  /* ---------------- accepted, contract, deposit ---------------- */

  const option = options[0]!;
  const contractTotal = option.pricing.totalPence;
  const acceptedAt = at(cal.accepted!, "20:14");
  const acceptance: AcceptanceRecord = {
    optionId: option.id,
    optionLabel: option.label,
    totalPence: contractTotal,
    name: sc.customer.signName,
    email: sc.customer.email,
    termsVersion: settings.legal.termsVersion,
    cancellationNoticeVersion: "DEMO",
    acknowledgedCancellationInfo: true,
    earlyStartRequested: sc.earlyStart === true,
    acknowledgedLossOfRight: false,
    at: acceptedAt,
    ip: "203.0.113.10",
    userAgent: "DEMO browser",
  };
  out.proposal = { ...proposal, status: "accepted", acceptance };
  story.act(
    { type: "proposal-accepted", proposalId: proposal.id, version: 1, optionLabel: option.label, contractTotalPence: contractTotal, earlyStartRequested: sc.earlyStart === true },
    acceptedAt,
  );
  message("proposal-accepted", "email", `${proposal.id}:v1`, at(cal.accepted!, "20:15"), "Your contract with Dang, It's Hot", `Thanks ${sc.customer.signName}. You accepted ${option.label} for ${fmtGbp(contractTotal)}. Your contract confirmation and the cancellation form are attached.`);
  story.act({ type: "contract-confirmation-sent", demo: true }, at(cal.accepted!, "20:15"));
  const contractDoc = document("contract", "contract", "Contract confirmation", at(cal.accepted!, "20:15"), {
    ...header(acceptedAt),
    proposalId: proposal.id,
    proposalVersion: 1,
    proposalRef: out.documents.find((d) => d.kind === "proposal")?.ref,
    option: customerSafe(out.proposal).options[0]!,
    acceptance,
    contractType: "supply-and-install",
    inclusions: INCLUSIONS,
    exclusions: EXCLUSIONS,
    assumptions: ASSUMPTIONS,
    warranty: proposal.warranty,
    termsVersion: settings.legal.termsVersion,
    cancellation: {
      text: `Because we're supplying your equipment, you can cancel without giving a reason until ${settings.scheduling.cancellationDays} days after the day it's delivered to you.`,
      earlyStartRequested: sc.earlyStart === true,
    },
    // The payment schedule frozen at acceptance, as the real accept flow does.
    payments: {
      depositPct: settings.payments.depositPct,
      depositPence: depositPenceOf(contractTotal, settings),
      depositTiming: settings.payments.depositTiming,
      balanceDueDays: settings.payments.balanceDueDays,
      methods: settings.payments.methods,
    },
    complaints: { process: settings.company.complaintsProcess, ...(settings.company.adr ? { adr: settings.company.adr } : {}) },
    guarantees: guaranteeLines(settings, proposal.warranty),
  });

  // Deposit: invoiced on acceptance, paid by bank transfer (DEMO: no real money). The same rule as F5's invoices.
  const depositPence = depositPenceOf(contractTotal, settings);
  const depositNumber = `DEMO-${String(invoiceCounter.n++).padStart(4, "0")}`;
  const depositIssuedAt = at(cal.accepted!, "20:20");
  const depositPaidAt = at(cal.depositPaid!, "09:12");
  const depositInvoiceId = id("invoice:deposit");
  const depositDocId = id("document:invoice-deposit");
  const depositPayment: Payment = {
    id: id("payment:deposit"),
    projectId,
    invoiceId: depositInvoiceId,
    method: "bank-transfer",
    provider: "demo",
    providerRef: `DEMO-PAY-${sc.n}01`,
    amountPence: depositPence,
    status: "succeeded",
    receivedAt: depositPaidAt,
    recordedBy: ADMIN.name,
  };
  const depositLine = { label: `Deposit (${settings.payments.depositPct}% of ${fmtGbp(contractTotal)})`, netPence: depositPence, taxCode: option.pricing.taxCode, taxPence: 0, totalPence: depositPence };
  const depositInvoice: Invoice = {
    id: depositInvoiceId,
    projectId,
    number: depositNumber,
    kind: "deposit",
    status: "paid",
    lines: [depositLine],
    netPence: depositPence,
    taxPence: 0,
    totalPence: depositPence,
    paidPence: depositPence,
    dueOn: addDays(cal.accepted!, settings.payments.balanceDueDays),
    issuedAt: depositIssuedAt,
    documentId: depositDocId,
    notes: "DEMO invoice: no real money changed hands.",
  };
  out.invoices.push(depositInvoice);
  out.payments.push(depositPayment);
  story.act({ type: "deposit-requested", amountPence: depositPence }, depositIssuedAt, ADMIN);
  story.act({ type: "invoice-issued", amountPence: depositPence }, depositIssuedAt, ADMIN);
  message("invoice-issued", "email", depositInvoiceId, depositIssuedAt, `Invoice ${depositNumber}`, `Your deposit invoice ${depositNumber} for ${fmtGbp(depositPence)} is in your documents.`);
  if (sc.earlyStart) {
    // Their reply to the confirmation email, with the early-start wording: the durable copy, stored with the project.
    const copy = photo(projectId, sc, {
      key: "early-start-email",
      scene: "document",
      tag: "document",
      room: "Their email",
      source: "ops",
      takenBy: { kind: "staff", id: ADMIN.id, name: ADMIN.name },
      takenAt: at(cal.evidenced!, "09:25"),
      customerVisible: false,
      plain: true,
      caption: "DEMO: the customer's early-start email, saved as a screenshot",
    });
    out.media.push(copy);
    story.act(
      {
        type: "early-start-evidenced",
        channel: "email",
        evidenceRef: `DEMO email of ${cal.evidenced}, Re: Your contract (DEMO-EMAIL-${sc.n}001)`,
        by: ADMIN.name,
        mediaIds: [copy.item.id],
        receivedOn: cal.evidenced!,
        fromAddress: sc.customer.email,
        wordingVersion: EARLY_START_WORDING_VERSION,
      },
      at(cal.evidenced!, "09:30"),
      ADMIN,
    );
  }
  story.act({ type: "payment-recorded", amountPence: depositPence }, depositPaidAt, ADMIN);
  story.act({ type: "deposit-paid", amountPence: depositPence }, depositPaidAt, ADMIN);
  message("payment-received", "email", depositPayment.providerRef, depositPaidAt, "Payment received", `We've received your deposit of ${fmtGbp(depositPence)}. Thank you.`);
  const invoiceSnapshot = (inv: Invoice, issuedAt: string, payments: Payment[]): DocumentSnapshots["invoice"] => ({
    ...header(issuedAt),
    invoice: { ...inv, status: payments.length ? inv.status : "issued", paidPence: sum(payments.map((p) => p.amountPence)) },
    payments,
    payTo: {
      methods: settings.payments.methods,
      ...(settings.company.bank ? { bank: settings.company.bank } : {}),
      reference: inv.number,
    },
  });
  document("invoice", "invoice-deposit", `Invoice ${depositNumber} (deposit)`, depositIssuedAt, invoiceSnapshot(depositInvoice, depositIssuedAt, []));
  document("receipt", "receipt-deposit", `Receipt for ${depositNumber}`, depositPaidAt, { ...header(depositPaidAt), payment: depositPayment, invoice: depositInvoice });
  timeEntry("admin", ADMIN, at(cal.accepted!, "21:00"), 20, undefined, "Contract and deposit invoice");

  /* ---------------- booking ---------------- */

  const crew =
    sc.n === 3
      ? [crewMember(TECH, "tech-lead"), crewMember(ELECTRICIAN, "electrician"), crewMember(SUBCONTRACTOR, "installer")]
      : [crewMember(TECH, "tech-lead"), crewMember(INSTALLER, "installer"), crewMember(ELECTRICIAN, "electrician")];
  const crewStaff = sc.n === 3 ? [TECH, ELECTRICIAN, SUBCONTRACTOR] : [TECH, INSTALLER, ELECTRICIAN];
  const installDays = [cal.d1!, cal.d2!, cal.d3!];
  story.act({ type: "install-dates-set", startDate: installDays[0]!, dates: installDays }, at(cal.booked!, "10:00"));
  story.act({ type: "crew-assigned", crew }, at(cal.booked!, "11:00"), ADMIN);
  story.facts.crew = crewStaff;
  story.act({ type: "booking-confirmed" }, at(cal.booked!, "11:05"), ADMIN);
  message("install-booked", "email", installDays.join(","), at(cal.booked!, "11:06"), "Your install is booked", `You're booked in for ${installDays[0]} to ${installDays[2]}. Your team: ${crew.map((m) => m.name).join(", ")}.`);
  for (const item of ["indoor-space", "parking", "adult-home"]) {
    story.act({ type: "prep-toggled", itemId: item, done: true }, at(cal.booked!, "19:30"));
  }
  timeEntry("admin", ADMIN, at(cal.booked!, "10:30"), 25, undefined, "Dates, crew and booking");

  /* ---------------- kit ---------------- */

  const variant = variants[0]!;
  const inspectedAt = sc.stop === "closed" ? at(cal.d1!, "08:20") : at(cal.kitInspected!, "15:30");
  const deliveredAt = at(cal.kitDelivered!, "12:40");
  const inspector = sc.stop === "closed" ? INSTALLER : TECH;
  // One serial per unit, by room and by system (two rooms may have the same model).
  const serialByRoom = new Map(variant.roomUnits.map((u, i) => [u.roomId, `DEMO-SN-${sc.n}${String(i + 1).padStart(3, "0")}`]));
  const serialBySystem = new Map(variant.systems.map((sy, i) => [sy.id, `DEMO-SN-${sc.n}${String(101 + i)}`]));
  const poLine = (key: string, i: number, itemId: string, qty: number, serials: string[]) => {
    const it = demoItem(itemId);
    return {
      id: `${key}-l${i + 1}`,
      catalogueItemId: it.id,
      label: it.label,
      qty,
      unitCostPence: it.costPence,
      ...(it.costPence !== null ? { actualUnitCostPence: it.costPence } : {}),
      receivedQty: qty,
      inspectedQty: qty,
      damagedQty: 0,
      serials,
      required: true,
    };
  };
  const poLines = {
    equipment: [
      ...variant.roomUnits.map((u, i) => poLine("equipment", i, u.indoorItemId, 1, [serialByRoom.get(u.roomId)!])),
      ...variant.systems.map((sy, i) => poLine("equipment", variant.roomUnits.length + i, sy.outdoorItemId, 1, [serialBySystem.get(sy.id)!])),
    ],
    materials: variant.bom
      .filter((l) => l.catalogueItemId && l.category !== "equipment")
      .map((l, i) => poLine("materials", i, l.catalogueItemId!, l.qty, [])),
  };
  for (const [poKey, supplier] of [
    ["equipment", "DEMO Aircon Supplies"],
    ["materials", "DEMO Trade Counter"],
  ] as const) {
    const lines = poLines[poKey];
    const total = sum(lines.map((l) => l.qty * (l.unitCostPence ?? 0)));
    out.purchaseOrders.push({
      id: id(`po:${poKey}`),
      projectId,
      supplier,
      reference: `DEMO-PO-${sc.n}-${poKey === "equipment" ? 1 : 2}`,
      status: "inspected",
      destination: "customer",
      lines,
      expectedTotalPence: total,
      actualTotalPence: total,
      shippingPence: poKey === "equipment" ? 0 : 2_500,
      orderedOn: cal.kitOrdered,
      eta: cal.kitDelivered,
      trackingRef: `DEMO-TRACK-${sc.n}${poKey === "equipment" ? 1 : 2}`,
      deliveredAt,
      inspectedAt,
      notes: "DEMO order: nothing was bought.",
      mediaIds: [],
      history: [
        { at: at(cal.kitOrdered!, "09:00"), by: ADMIN.name, note: "Ordered (DEMO).", status: "ordered" },
        { at: at(cal.kitConfirmed!, "14:00"), by: ADMIN.name, note: `Supplier confirmed delivery for ${cal.kitDelivered}.`, status: "confirmed" },
        { at: deliveredAt, by: ADMIN.name, note: "Delivered to the customer's home, signed for by the customer.", status: "delivered" },
        { at: inspectedAt, by: inspector.name, note: "Every box checked against the design; serials recorded.", status: "inspected" },
      ],
    });
  }
  const kitPhoto = photo(projectId, sc, {
    key: "kit-check",
    scene: "kit",
    tag: "kit",
    room: "Hallway",
    source: "install",
    takenBy: { kind: "staff", id: inspector.id, name: inspector.name },
    takenAt: inspectedAt,
    customerVisible: false,
  });
  out.media.push(kitPhoto);
  for (const po of out.purchaseOrders) po.mediaIds = [kitPhoto.item.id];
  const requiredLines = sum(out.purchaseOrders.map((po) => po.lines.filter((l) => l.required).length));
  story.facts.kit = { requiredLines, deliveredLines: requiredLines, inspectedLines: requiredLines, damaged: 0 };

  story.act({ type: "kit-updated", status: "ordered", shortages: 0, summary: "Units and materials ordered (DEMO)" }, at(cal.kitOrdered!, "09:05"), ADMIN);
  story.act({ type: "kit-updated", status: "confirmed", expectedDate: cal.kitDelivered!, shortages: 0 }, at(cal.kitConfirmed!, "14:05"), ADMIN);
  message("kit-update", "email", "confirmed", at(cal.kitConfirmed!, "14:06"), "Your kit is confirmed", `The supplier has confirmed your kit for ${cal.kitDelivered}.`);
  story.act({ type: "kit-updated", status: "delivered", shortages: 0 }, deliveredAt, ADMIN);
  message("kit-update", "email", "delivered", deliveredAt, "Your kit has arrived", "Your kit has been delivered. Your installer will check every box.");

  /* ---------------- compliance for ready-to-install ---------------- */

  const readyStage: Partial<Record<string, ChecklistState>> = { ...proposalStage };
  for (const key of keysUpTo("ready-to-install", GATE_IDS)) {
    if (!readyStage[key] || readyStage[key]!.status !== "approved") {
      readyStage[key] = approved(TECH, at(cal.booked!, "15:00"), key === "cancellation-and-consent" ? (sc.earlyStart ? "Early start requested and evidenced by email (DEMO)." : "Cancellation period ended before day 1 (DEMO).") : undefined);
    }
  }
  // The refrigerant work runs under a DEMO certified company: its certificate is attached, so the item
  // doesn't rest on a company certificate in settings (which a fresh install doesn't have).
  const fgasCert = photo(projectId, sc, {
    key: "fgas-company-certificate",
    scene: "document",
    tag: "document",
    room: "F-gas company certificate",
    source: "ops",
    takenBy: { kind: "staff", id: TECH.id, name: TECH.name },
    takenAt: at(cal.booked!, "14:55"),
    customerVisible: false,
    plain: true,
    caption: "DEMO: the certified company's F-gas certificate (DEMO-REFCOM-0001)",
  });
  out.media.push(fgasCert);
  readyStage["fgas-company"] = approved(TECH, at(cal.booked!, "15:00"), "Refrigerant work under DEMO Cool Ltd's company certificate, DEMO-REFCOM-0001 (DEMO).", [fgasCert.item.id]);
  if (!sc.systems.some((s) => s.position.accessEquipment === "tower")) {
    readyStage["working-at-height"] = { status: "not-applicable", note: "Ground-level outdoor unit; penetrations drilled from inside (DEMO).", reviewedBy: TECH.name, reviewedAt: at(cal.booked!, "15:00") };
  }
  out.compliance = demoChecklist(projectId, (k) => id(`compliance:${k}`), readyStage);
  story.facts.compliance = out.compliance.map(complianceView);

  const runsheet = decorateRunsheet(buildRunsheet({ rooms: sc.rooms.map((r) => r.name), outdoorUnits: sc.systems.length }));
  const job: InstallJobParts = {
    id: id("install-job"),
    projectId,
    designId: design.id,
    templateVersion: "demo-runsheet-1",
    runsheet,
    stepStatuses: [],
    exceptionReviews: [],
    qa: { status: "in-progress" },
  };
  out.installJob = job;

  if (sc.stop === "ready-to-install") {
    story.act({ type: "kit-updated", status: "inspected", shortages: 0 }, inspectedAt, TECH);
    message("kit-update", "email", "inspected", inspectedAt, "Your kit has been checked", `${TECH.name} has checked your kit against the design. Everything's here.`);
    story.act(
      { type: "set-next-action", text: `Day 1 on ${installDays[0]}: confirm the parking`, dueOn: addDays(installDays[0]!, -1), ownerRole: "tech-lead" },
      at(cal.kitInspected!, "16:00"),
      ADMIN,
    );
    timeEntry("admin", ADMIN, at(cal.kitOrdered!, "09:00"), 30, undefined, "Purchase orders");
    return finish(out, story, today);
  }

  /* ---------------- install: three days ---------------- */

  const fieldBy = (s: StaffMember) => ({ kind: "staff" as const, id: s.id, name: s.name });
  const progress1 = photo(projectId, sc, { key: "day1-progress", scene: "progress", tag: "progress", room: sc.rooms[0]!.name, roomId: sc.rooms[0]!.key, source: "install", takenBy: fieldBy(INSTALLER), takenAt: at(cal.d1!, "16:20"), customerVisible: true, caption: "Day 1: core hole drilled and sealed, bracket up (DEMO)" });
  const progress2 = photo(projectId, sc, { key: "day2-progress", scene: "progress", tag: "progress", room: sc.rooms[1]?.name ?? sc.rooms[0]!.name, roomId: (sc.rooms[1] ?? sc.rooms[0]!).key, variant: 1, source: "install", takenBy: fieldBy(INSTALLER), takenAt: at(cal.d2!, "16:40"), customerVisible: true, caption: "Day 2: pipework run and insulated (DEMO)" });
  const finished = sc.rooms.map((r, i) =>
    photo(projectId, sc, {
      key: `finished-${r.key}`,
      scene: "completed",
      tag: "completed",
      room: r.name,
      roomId: r.key,
      variant: i,
      unitLabel: `${demoItem(r.std).label}`,
      source: "handover",
      takenBy: fieldBy(TECH),
      takenAt: at(cal.d3!, `15:${String(i * 5).padStart(2, "0")}`),
      customerVisible: true,
    }),
  );
  out.media.push(progress1, progress2, ...finished);

  // Evidence for every slot, recorded by whoever may record it, inside every window.
  const recorder = (s: InstallStep): StaffMember => (s.requires === "electrical" ? ELECTRICIAN : s.requires ? TECH : INSTALLER);
  const dayDate = (s: InstallStep) => (s.day === 1 ? cal.d1! : s.day === 2 ? cal.d2! : cal.d3!);
  const minuteOf = new Map<number, number>();
  const evidence: StoredEvidenceRecord[] = [];
  const statuses: StepStatusRecord[] = [];
  const finishedByRoom = new Map(sc.rooms.map((r, i) => [r.name, finished[i]!.item.id]));
  for (const step of runsheet) {
    const day = step.day ?? 1;
    const who = recorder(step);
    for (const spec of step.evidence) {
      const m = (minuteOf.get(day) ?? 8 * 60 + 40) + 4;
      minuteOf.set(day, m);
      const atIso = at(dayDate(step), `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
      const reading = NUMERIC_KINDS.has(spec.kind) ? (READINGS.find(([re]) => re.test(spec.label))?.[1] ?? plausibleValue(spec)) : undefined;
      let ref: string | undefined;
      let mediaId: string | undefined;
      if (spec.kind === "qr-scan" || spec.kind === "barcode-scan") {
        const indoor = step.item ? sc.rooms.find((r) => r.name === step.item) : undefined;
        ref = /Indoor unit serial/.test(spec.label) && indoor
          ? serialByRoom.get(indoor.key)
          : /Outdoor serial/.test(spec.label)
            ? serialBySystem.get(variant.systems[0]!.id)
            : /Cable drum/.test(spec.label)
              ? "DEMO-CABLE-2.5MM"
              : "DEMO-RCBO-16C";
      } else if (spec.kind === "photo" || spec.kind === "video" || spec.kind === "signature") {
        if (step.title === "Finished photos" && step.item) mediaId = finishedByRoom.get(step.item);
        else if (step.title === "Penetration" && step.item === sc.rooms[0]!.name && /Sleeve/.test(spec.label)) mediaId = progress1.item.id;
        else if (step.title === "Pipe run" && /insulation/.test(spec.label) && step.item === (sc.rooms[1] ?? sc.rooms[0]!).name) mediaId = progress2.item.id;
        ref = mediaId ? undefined : `demo-${spec.kind}-${spec.id}`;
      }
      evidence.push({
        id: `demo-${sc.key}-${spec.id}`,
        specId: spec.id,
        ...(reading !== undefined ? { value: reading } : {}),
        ...(ref ? { ref } : {}),
        at: atIso,
        ...(spec.kind === "gps" ? { gps: DEMO_GPS } : {}),
        by: who.name,
        byStaffId: who.id,
        ...(mediaId ? { mediaId } : {}),
      });
    }
    const last = evidence[evidence.length - 1]!;
    statuses.push({ stepId: step.id, outcome: "pass", at: last.at, by: who.name, byStaffId: who.id });
  }
  out.evidence = evidence;

  const coolingSplitC: Record<string, number> = {};
  const heatingSplitC: Record<string, number> = {};
  sc.rooms.forEach((r, i) => {
    coolingSplitC[r.name] = round1(11.8 + i * 0.6);
    heatingSplitC[r.name] = round1(18.5 + i * 0.7);
  });
  const system = variant.systems[0]!;
  const outdoorItem = demoItem(system.outdoorItemId);
  const commissioning: CommissioningRecord = {
    signedBy: { staffId: TECH.id, name: TECH.name, qualificationRef: techRef() },
    at: at(cal.d3!, "15:40"),
    results: [
      {
        system: "System",
        strengthTestBar: 41.5,
        holdBar: 41.4,
        vacuumMicrons: 350,
        decayMicrons: 480,
        additionalChargeG: system.refrigerant.additionalChargeG,
        coolingSplitC,
        heatingSplitC,
        noiseDb: 38,
        serials: [
          { item: `${outdoorItem.label}`, serial: serialBySystem.get(system.id)! },
          ...sc.rooms.map((r) => ({ item: `${r.name}: ${demoItem(r.std).label}`, serial: serialByRoom.get(r.key)! })),
        ],
      },
    ],
    notes: "DEMO commissioning record: readings are fictional.",
  };
  const fullJob = { ...job, stepStatuses: statuses, commissioning, qa: { status: "signed-off" as const, reviewedBy: TECH.name, note: "All slots passed (DEMO)." } };
  const card = scoreInstallation({ ...fullJob, customer: sc.customer.name, postcode: sc.customer.postcode, engineer: TECH.name, scheduledOn: cal.d1!, evidence });
  if (card.completenessPct !== 100 || card.exceptions.length > 0) {
    throw new DemoSeedError(`${sc.label}: demo runsheet evidence isn't complete (${card.completenessPct}%, ${card.exceptions.length} exceptions)`);
  }
  out.installJob = fullJob;

  const updates = [
    "Holes drilled and sealed, brackets up, outdoor base down. Tomorrow: the units go on the wall and the pipework goes in.",
    "Both indoor units are up, the outdoor unit is set and the pipework is run and insulated. Tomorrow: the new circuit, pressure test, commissioning and your handover.",
    "All done: tested, commissioned and handed over. Enjoy it.",
  ];
  story.act({ type: "installer-on-my-way", etaMinutes: 15, by: TECH.name }, at(cal.d1!, "07:50"), TECH);
  message("installer-on-my-way", "sms", cal.d1!, at(cal.d1!, "07:50"), "", `${TECH.name} is on the way, about 15 minutes out.`);
  story.act({ type: "kit-updated", status: "inspected", shortages: 0 }, inspectedAt, INSTALLER);
  const dayTimes: [string, string][] = [
    ["08:30", "16:45"],
    ["08:15", "17:05"],
    ["08:05", "15:10"],
  ];
  installDays.forEach((date, i) => {
    const n = i + 1;
    if (n === 1) story.facts.runsheet = { complete: false, openExceptions: 0, missing: 0, blocked: 0, walkthroughDone: false };
    story.act({ type: "install-day-started", n, by: TECH.name }, at(date, dayTimes[i]![0]), TECH);
    const mediaIds = n === 1 ? [progress1.item.id] : n === 2 ? [progress2.item.id] : finished.map((f) => f.item.id);
    story.act({ type: "install-day-ended", n, summary: `Day ${n} complete (DEMO).`, customerUpdate: { text: updates[i]!, mediaIds } }, at(date, dayTimes[i]![1]), TECH);
    message("install-day-update", "email", `day-${n}`, at(date, dayTimes[i]![1]), `Day ${n} done`, updates[i]!);
    for (const person of crewStaff.filter((s) => s.id !== ELECTRICIAN.id || n === 3)) {
      const start = at(date, dayTimes[i]![0]);
      const [sh, sm] = dayTimes[i]![0].split(":").map(Number) as [number, number];
      const [eh, em] = dayTimes[i]![1].split(":").map(Number) as [number, number];
      const minutes = person.id === ELECTRICIAN.id ? 300 : eh * 60 + em - (sh * 60 + sm);
      timeEntry("travel", person, at(date, "07:35"), 35, n);
      timeEntry("install", person, start, minutes, n);
    }
  });
  story.facts.runsheet = { complete: true, openExceptions: 0, missing: 0, blocked: 0, walkthroughDone: card.gates.walkthrough };
  story.act({ type: "install-completed" }, at(cal.d3!, "15:20"), TECH);
  story.facts.commissioning = { signed: true, signedBy: TECH.name };
  story.act({ type: "commissioning-signed", by: TECH.name }, at(cal.d3!, "15:40"), TECH);
  timeEntry("commissioning", TECH, at(cal.d3!, "13:40"), 90, 3);

  /* ---------------- documents at handover ---------------- */

  const equipment: InstalledEquipmentRow[] = [
    ...sc.rooms.map((r) => ({ room: r.name, label: demoItem(r.std).label, model: demoItem(r.std).model ?? "", serial: serialByRoom.get(r.key)! })),
    { room: `Outdoor: ${sc.systems[0]!.position.label}`, label: outdoorItem.label, model: outdoorItem.model ?? "", serial: serialBySystem.get(system.id)! },
  ];
  const certDoc = document("commissioning-certificate", "commissioning-certificate", "Commissioning certificate", at(cal.d3!, "15:45"), {
    ...header(at(cal.d3!, "15:45")),
    commissioning,
    equipment,
  });
  const deadlines = handoverDeadlines(cal.d3!);
  const packId = id("document:handover-pack"); // document()'s id for the "handover-pack" key
  const link = (d: DemoDocument) => ({ kind: d.kind, ref: d.ref, id: d.id, title: d.title });
  const pack = document("handover-pack", "handover-pack", "Your handover pack", at(cal.d3!, "16:00"), {
    ...header(at(cal.d3!, "16:00")),
    completedOn: cal.d3!,
    equipment,
    commissioning,
    documents: [certDoc, contractDoc, ...out.documents.filter((d) => d.kind === "invoice" || d.kind === "receipt")].map(link),
    warranty: { text: settings.warranty.manufacturerSummary, registered: false, dueOn: addDays(cal.d3!, 30) },
    electricalCert: { status: "pending", dueBy: deadlines.electricalCertDueBy },
    maintenanceInfo: { dueBy: deadlines.maintenanceInfoDueBy, provided: true },
    fgas: [fgasRecord({ system: "System", factoryChargeKg: 1.4, additionalChargeG: system.refrigerant.additionalChargeG })],
    care: [
      "Clean the filters every few weeks in heavy use: they lift out from the front panel.",
      "Steam from the outdoor unit in winter is normal: it's defrosting.",
      "Set it and leave it: a steady temperature uses less than switching on and off.",
      "Keep 30 cm clear around the outdoor unit.",
    ],
    contacts: [
      { label: "Your technical lead", name: TECH.name },
      { label: settings.company.tradingName, phone: settings.company.phone, email: settings.company.email },
    ],
    // The as-built photos, frozen as the field app does: finished first, then progress.
    asBuilt: [...finished, progress2, progress1].map((m) => ({ mediaId: m.item.id, ...(m.item.caption ? { caption: m.item.caption } : {}) })),
  });
  if (pack.id !== packId) throw new DemoSeedError("handover pack id drifted");
  story.act({ type: "handover-pack-published", documentId: packId }, at(cal.d3!, "16:00"), TECH);
  message("handover-ready", "email", packId, at(cal.d3!, "16:01"), "Your handover pack is ready", "Your handover pack is ready in your documents: equipment, serials, commissioning results and how to look after it.");

  // The walkthrough found one loose clip: signed with a snag, fixed three days later.
  story.act({ type: "handover-signed", name: sc.customer.signName, outcome: "snags", snagCount: 1 }, at(cal.d3!, "16:25"));
  timeEntry("handover", TECH, at(cal.d3!, "15:45"), 45, 3);
  // A few working days after the handover, and always before the 7-day check-in (Christmas and
  // the other bank holidays can push "the next working day" a week out).
  const snagNext = nextWorkingDay(addDays(cal.d3!, 3));
  const snagFixed = snagNext <= addDays(cal.d3!, 5) ? snagNext : prevWorkingDay(addDays(cal.d3!, 3));
  out.issues.push({
    id: id("issue:1"),
    projectId,
    number: 1,
    kind: "snag",
    title: "Condensate pipe clip loose behind the living room unit",
    severity: "low",
    status: "resolved",
    blocking: false,
    ownerRole: "installer",
    ownerStaffId: INSTALLER.id,
    ownerName: INSTALLER.name,
    raisedBy: { kind: "customer", name: sc.customer.name },
    raisedAt: at(cal.d3!, "16:25"),
    mediaIds: [finished[finished.length - 1]!.item.id],
    customerVisible: true,
    resolution: "Clip replaced and the trunking resealed. Customer happy (DEMO).",
    resolvedAt: at(snagFixed, "15:00"),
    history: [
      { at: at(cal.d3!, "16:25"), by: sc.customer.name, note: "Raised at handover.", status: "open" },
      { at: at(addDays(cal.d3!, 1), "09:00"), by: ADMIN.name, note: `Booked ${INSTALLER.name} for ${snagFixed}.`, status: "in-progress" },
      { at: at(snagFixed, "15:00"), by: INSTALLER.name, note: "Fixed on site.", status: "resolved" },
    ],
  });
  timeEntry("travel", INSTALLER, at(snagFixed, "14:00"), 25, undefined, "Snag visit");
  timeEntry("rework", INSTALLER, at(snagFixed, "14:25"), 35, undefined, "Loose condensate clip");

  /* ---------------- money, paperwork, aftercare, close ---------------- */

  const balancePence = contractTotal - depositPence;
  const balanceNumber = `DEMO-${String(invoiceCounter.n++).padStart(4, "0")}`;
  const balanceIssuedAt = at(cal.d3!, "17:00");
  const balancePaidAt = at(addDays(snagFixed, 1), "09:12");
  const balanceInvoiceId = id("invoice:balance");
  const balanceDocId = id("document:invoice-balance");
  const balancePayment: Payment = {
    id: id("payment:balance"),
    projectId,
    invoiceId: balanceInvoiceId,
    method: "card",
    provider: "demo",
    providerRef: `DEMO-PAY-${sc.n}02`,
    amountPence: balancePence,
    status: "succeeded",
    receivedAt: balancePaidAt,
    recordedBy: "DEMO payments",
  };
  const balanceInvoice: Invoice = {
    id: balanceInvoiceId,
    projectId,
    number: balanceNumber,
    kind: "balance",
    status: "paid",
    lines: [{ label: `Balance: ${option.label}, after the ${fmtGbp(depositPence)} deposit`, netPence: balancePence, taxCode: option.pricing.taxCode, taxPence: 0, totalPence: balancePence }],
    netPence: balancePence,
    taxPence: 0,
    totalPence: balancePence,
    paidPence: balancePence,
    dueOn: addDays(cal.d3!, settings.payments.balanceDueDays),
    issuedAt: balanceIssuedAt,
    documentId: balanceDocId,
    notes: "DEMO invoice: no real money changed hands.",
  };
  out.invoices.push(balanceInvoice);
  out.payments.push(balancePayment);
  story.act({ type: "invoice-issued", amountPence: balancePence }, balanceIssuedAt, ADMIN);
  message("invoice-issued", "email", balanceInvoiceId, balanceIssuedAt, `Invoice ${balanceNumber}`, `Your balance invoice ${balanceNumber} for ${fmtGbp(balancePence)} is in your documents. It's due by ${balanceInvoice.dueOn}.`);
  document("invoice", "invoice-balance", `Invoice ${balanceNumber} (balance)`, balanceIssuedAt, invoiceSnapshot(balanceInvoice, balanceIssuedAt, []));

  // The certificate and the registration go into the documents first, then the project says so.
  const warrantyAt = at(nextWorkingDay(addDays(cal.d3!, 1)), "10:00");
  const warrantyDoc = document("certificate", "certificate-warranty", "Manufacturer warranty registration", warrantyAt, {
    ...header(warrantyAt),
    certificate: { kind: "warranty-registration", title: "Manufacturer warranty registration", reference: "DEMO-WR-0042", issuer: "DEMO manufacturer", receivedOn: warrantyAt.slice(0, 10), mediaIds: [] },
  });
  story.act({ type: "warranty-registered", documentId: warrantyDoc.id }, warrantyAt, ADMIN);
  const certAt = at(snagFixed, "11:00");
  const eicDoc = document("certificate", "certificate-electrical", "Electrical installation certificate", certAt, {
    ...header(certAt),
    certificate: { kind: "electrical-installation", title: "Electrical installation certificate", reference: "DEMO-EIC-0001", issuer: "DEMO scheme", receivedOn: certAt.slice(0, 10), mediaIds: [] },
  });
  story.act({ type: "electrical-cert-updated", status: "received", documentId: eicDoc.id }, certAt, ADMIN);
  story.act({ type: "payment-recorded", amountPence: balancePence }, balancePaidAt);
  message("payment-received", "email", balancePayment.providerRef, balancePaidAt, "Payment received", `We've received your balance of ${fmtGbp(balancePence)}. Thank you: you're all paid up.`);
  document("receipt", "receipt-balance", `Receipt for ${balanceNumber}`, balancePaidAt, { ...header(balancePaidAt), payment: balancePayment, invoice: balanceInvoice });

  story.act({ type: "aftercare-checkin-sent" }, at(addDays(cal.d3!, 7), "10:00"));
  message("check-in-7d", "email", "7d", at(addDays(cal.d3!, 7), "10:00"), "How's it running?", `Hi ${sc.customer.signName}, a week in: how's your new system? Reply or use your portal if anything's not right.`);
  story.act(
    { type: "feedback-submitted", score: 9, comments: "Tidy, quick and the bedroom is finally cool at night. One loose clip, fixed within days. (DEMO)" },
    at(addDays(cal.d3!, 7), "20:31"),
  );

  out.compliance = demoChecklist(projectId, (k) => id(`compliance:${k}`), {
    ...readyStage,
    "commissioning-approval": approved(TECH, at(cal.d3!, "15:40")),
    "electrical-certificate": approved(ELECTRICIAN, at(snagFixed, "11:00"), "Certificate received from the scheme (DEMO)."),
    "warranty-registration": approved(ADMIN, at(nextWorkingDay(addDays(cal.d3!, 1)), "10:00"), "Registered with the manufacturer (DEMO)."),
  });
  story.facts.compliance = out.compliance.map(complianceView);
  story.facts.openIssues = [];
  story.facts.money = { depositDuePence: depositPence, depositPaidPence: depositPence, outstandingPence: 0, unbilledPence: 0 };
  story.act({ type: "project-closed" }, at(addDays(cal.d3!, 8), "09:30"), ADMIN);

  out.learnings.push(
    {
      id: id("learning:1"),
      projectId,
      dayN: 1,
      stage: "install",
      author: { staffId: INSTALLER.id, name: INSTALLER.name },
      answers: [
        { promptId: "took-longer", answer: "Core drilling the solid brick rear wall took 40 minutes longer than planned (DEMO)." },
        { promptId: "tool", answer: "A 350 mm SDS core bit for solid walls (DEMO)." },
      ],
      tags: ["survey", "tools"],
      status: "applied",
      appliedNote: "The survey now records wall thickness (DEMO).",
      createdAt: at(cal.d1!, "16:50"),
    },
    {
      id: id("learning:2"),
      projectId,
      dayN: 3,
      stage: "handover",
      author: { staffId: TECH.id, name: TECH.name },
      answers: [
        { promptId: "survey-gap", answer: "The cable route through the kitchen ceiling void wasn't measured (DEMO)." },
        { promptId: "customer-confused", answer: "Whether heating mode needs the same filter cleaning (it does) (DEMO)." },
      ],
      tags: ["survey", "handover"],
      status: "open",
      createdAt: at(cal.d3!, "17:10"),
    },
  );

  return finish(out, story, today);
}

function approved(by: StaffMember, reviewedAt: string, note?: string, mediaIds?: string[]): ChecklistState {
  return { status: "approved", reviewedBy: by.name, reviewedAt, ...(note ? { note } : {}), ...(mediaIds ? { mediaIds } : {}) };
}

const complianceView = (c: ComplianceItem) => ({ key: c.key, label: c.label, status: c.status, statutory: c.statutory, gate: c.gate });

function finish(out: DemoProject, story: Story, today: string): DemoProject {
  out.project = story.project;
  out.ctx = story.ctx(at(today, "12:00"));
  return out;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** The five DEMO pilots, consistent end to end, as of `now`. */
export function buildDemoDataset(input: { now: string; settings?: PilotSettings }): DemoDataset {
  const nowDate = new Date(input.now);
  if (!Number.isFinite(nowDate.getTime())) throw new DemoSeedError("buildDemoDataset: `now` isn't a date");
  const today = londonDate(nowDate);
  const settings = demoSettings(input.settings ?? DEFAULT_SETTINGS);
  // Invoice numbers are global: allocate them in the order the stories issued them.
  const invoiceCounter = { n: 1 };
  const order = [5, 3, 1, 2, 4];
  const built = new Map<number, DemoProject>();
  for (const n of order) {
    const sc = SCENARIOS.find((s) => s.n === n)!;
    const project = buildProject(sc, today, settings, invoiceCounter);
    project.ctx = { ...project.ctx, today };
    built.set(n, project);
  }
  return {
    now: input.now,
    today,
    settings,
    catalogue: DEMO_CATALOGUE_ITEMS,
    compatibility: DEMO_COMPATIBILITY_RULES,
    staff: Object.values(DEMO_STAFF),
    projects: SCENARIOS.map((s) => built.get(s.n)!),
  };
}

/** The emails the demo customers use: what a reset may delete from `customers`. */
export const DEMO_CUSTOMER_EMAILS: readonly string[] = SCENARIOS.map((s) => s.customer.email);
/** The demo project ids, deterministic. */
export const DEMO_PROJECT_IDS: readonly string[] = SCENARIOS.map((s) => demoId(`${s.key}:project`));
