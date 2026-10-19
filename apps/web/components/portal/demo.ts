import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type PilotSettings,
  type Project,
  type ReadinessContext,
  type StaffMember,
} from "@aircon/domain";
import {
  earliestOfferedStart,
  installBlockOptions,
  londonWallClock,
  surveySlotDays,
} from "./schedule.ts";
import type { HubData, HubDocument, HubInvoice, HubIssue, HubPhoto } from "./types.ts";
import { customerSafeProject, hubFacts, outstandingOf, personCard } from "./view.ts";

/**
 * The browser demo (/p/demo): a whole v2 journey with no database. The
 * real reducer runs here with a permissive, clearly fictional readiness
 * context, so every gate still applies (try issuing a proposal before
 * agreeing to email documents), but the facts only ops could record
 * (compliance approved, kit counted, commissioning results) are stood in
 * by the demo. Everything is labelled DEMO; nothing is saved.
 */

const DEMO_EXPIRY = "2030-12-31";

/** The settings the demo runs under: defaults, with DEMO stand-ins for the legally required blanks and a 20% deposit. */
export const DEMO_SETTINGS: PilotSettings = mergeSettings({
  ...DEFAULT_SETTINGS,
  company: {
    ...DEFAULT_SETTINGS.company,
    geographicAddress: "DEMO address: 1 Demo Street, London SW16 9ZZ",
    // Ofcom's drama range (020 7946 0xxx): never a real line.
    phone: "020 7946 0123",
    complaintsProcess: "DEMO: tell us by phone or email and we reply within two working days.",
  },
  warranty: { workmanshipYears: null, manufacturerSummary: "DEMO: the manufacturer's parts warranty, once we've registered it for you." },
  payments: { ...DEFAULT_SETTINGS.payments, depositPct: 20, depositTiming: "on-acceptance" },
});

const person = (id: string, name: string, roles: StaffMember["roles"], quals: StaffMember["qualifications"], bio: string): StaffMember => ({
  id,
  email: `${id}@demo.dang.invalid`,
  name,
  roles,
  external: false,
  active: true,
  // Checked, with a DEMO certificate on file: only verified qualifications count (domain staff.ts).
  qualifications: quals.map((q) => ({ ...q, verifiedAt: "2026-01-05T09:00:00.000Z", verifiedBy: "DEMO", mediaId: `demo-certificate-${q.reference}` })),
  bio,
  demo: true,
});

export const DEMO_TEAM = {
  surveyor: person(
    "demo-surveyor",
    "Sam Okafor (DEMO)",
    ["surveyor"],
    [{ kind: "asbestos-awareness", reference: "DEMO-ASB-01", expiresOn: DEMO_EXPIRY }],
    "DEMO person. Measures every room twice and writes everything down, so nothing said on the day gets lost.",
  ),
  techLead: person(
    "demo-tech",
    "Tess Marlow (DEMO)",
    ["tech-lead"],
    [{ kind: "fgas-cat1", reference: "DEMO-FGAS-01", expiresOn: DEMO_EXPIRY }],
    "DEMO person. Checks and signs off every design, and commissions every system before we leave.",
  ),
  installer: person(
    "demo-installer",
    "Ivo Brennan (DEMO)",
    ["installer"],
    [
      { kind: "fgas-cat1", reference: "DEMO-FGAS-02", expiresOn: DEMO_EXPIRY },
      { kind: "pasma", reference: "DEMO-PASMA-01", expiresOn: DEMO_EXPIRY },
    ],
    "DEMO person. Leads on site. Brings his own dust sheets and a very good hoover.",
  ),
  electrician: person(
    "demo-electrician",
    "Eli Hart (DEMO)",
    ["electrician"],
    [
      { kind: "part-p", reference: "DEMO-PARTP-01", expiresOn: DEMO_EXPIRY },
      { kind: "18th-edition", reference: "DEMO-BS7671-01", expiresOn: DEMO_EXPIRY },
    ],
    "DEMO person. Fits and certifies the new circuit.",
  ),
};

const ALL: StaffMember[] = Object.values(DEMO_TEAM);
export const demoStaff = (id: string) => ALL.find((s) => s.id === id);

/** The extra records a real project keeps outside its snapshot, held in browser state. */
export interface DemoState {
  project: Project;
  /** The demo's own clock (ms). Starts at the project's creation and only moves forward. */
  now: number;
  issues: HubIssue[];
  invoices: HubInvoice[];
  documents: HubDocument[];
  photos: Record<string, HubPhoto>;
}

/**
 * The readiness facts the demo stands in for. With `actor`, a DEMO team
 * member did it (qualified for the gates that need one).
 */
export function demoContext(s: DemoState, actor?: StaffMember): ReadinessContext {
  const p = s.project;
  const arrived = p.kit.status === "delivered" || p.kit.status === "inspected";
  const planned = Math.max(1, p.booking.installDays);
  const daysDone = p.install.days.filter((d) => d.status === "done").length;
  const invoiced = s.invoices.reduce((sum, i) => sum + i.totalPence, 0);
  const paid = s.invoices.reduce((sum, i) => sum + i.paidPence, 0);
  const deposit = s.invoices.find((i) => i.kind === "deposit");
  return {
    today: londonWallClock(new Date(s.now)).slice(0, 10),
    settings: DEMO_SETTINGS,
    ...(actor ? { actor } : {}),
    surveyCompleteness: { pct: 100, missing: [] },
    design: { status: p.design.status, compatibilityErrors: [] },
    proposalCheck: { belowMinMargin: false, marginOverride: false, taxConfirmed: true, taxOverride: false, expired: false },
    compliance: [{ key: "demo-checklist", label: "DEMO compliance checklist", status: "approved", statutory: true, gate: "ready-to-install" }],
    crew: p.booking.crew.map((c) => demoStaff(c.staffId)).filter((x): x is StaffMember => Boolean(x)),
    kit: { requiredLines: 4, deliveredLines: arrived ? 4 : 0, inspectedLines: p.kit.status === "inspected" ? 4 : 0, damaged: 0 },
    openIssues: [],
    runsheet: { complete: daysDone >= planned, openExceptions: 0, missing: 0, blocked: 0, walkthroughDone: p.install.status === "complete" },
    commissioning: { signed: p.install.status === "complete", signedBy: DEMO_TEAM.techLead.name },
    money: {
      depositDuePence: deposit?.totalPence ?? 0,
      depositPaidPence: deposit?.paidPence ?? 0,
      outstandingPence: Math.max(0, invoiced - paid),
      unbilledPence: Math.max(0, (p.money.contractTotalPence ?? 0) - invoiced),
    },
  };
}

/** The hub's data for the demo, from the demo state. Pure: the same state renders the same page. */
export function demoHubData(s: DemoState): HubData {
  const p = s.project;
  const nowIso = new Date(s.now).toISOString();
  const wall = londonWallClock(new Date(s.now));
  const today = wall.slice(0, 10);
  const settings = DEMO_SETTINGS;
  const wantsBlocks = p.proposal.status === "accepted" && p.install.status === "not-started";
  const invoiced = s.invoices.reduce((sum, i) => sum + i.totalPence, 0);
  const paid = s.invoices.reduce((sum, i) => sum + i.paidPence, 0);
  const pack = s.documents.find((d) => d.kind === "handover-pack");
  const completedOn = p.install.completedAt?.slice(0, 10) ?? today;
  return {
    // The demo records every message and sends none: a text when there's a mobile, as the outbox would.
    // …and pays with the labelled card simulator.
    ...hubFacts(p, settings, today, p.customer.phone?.trim() ? "sms" : p.customer.email ? "email" : null, { available: false, simulate: true }),
    project: customerSafeProject(p),
    today,
    nowIso,
    viewer: { kind: "demo" },
    surveyor: p.survey.surveyor ? personCard(demoStaff(p.survey.surveyor.staffId) ?? DEMO_TEAM.surveyor, today, { role: "surveyor" }) : null,
    crew: p.booking.crew.map((c) => {
      const staff = demoStaff(c.staffId);
      return staff ? personCard(staff, today, { role: c.role }) : { name: c.name, role: c.role, photoUrl: null, qualifications: [] };
    }),
    surveySlots: p.survey.status === "not-booked" || p.survey.status === "booked" ? surveySlotDays({ settings, nowWall: wall, taken: [] }) : [],
    installBlocks: wantsBlocks ? installBlockOptions({ project: p, settings, today, booked: [] }) : [],
    earliestStart: earliestOfferedStart(p, today, settings),
    documents: [...s.documents].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    issues: s.issues,
    invoices: s.invoices,
    money: { invoicedPence: invoiced, paidPence: paid, outstandingPence: outstandingOf(s.invoices) },
    photos: s.photos,
    commissioning:
      p.handover.status !== "pending" && p.handover.commissionedAt
        ? { at: p.handover.commissionedAt, by: p.handover.commissionedBy ?? DEMO_TEAM.techLead.name, qualificationRef: "DEMO-FGAS-01", systems: Math.max(1, p.quoteSummary.systems.length) }
        : null,
    pack: pack
      ? {
          documentId: pack.id,
          completedOn,
          electricalCert: { status: p.handover.electricalCert, dueBy: completedOn },
          maintenanceInfo: { dueBy: completedOn, provided: true },
          warranty: { text: settings.warranty.manufacturerSummary, registered: p.handover.warrantyRegistered, ...(p.handover.warrantyDueOn ? { dueOn: p.handover.warrantyDueOn } : {}) },
        }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* DEMO pictures                                                       */
/* ------------------------------------------------------------------ */

/**
 * Drawn stand-ins for the installer's end-of-day photos, so the demo never
 * shows a real home. Each is clearly marked DEMO illustration.
 */
export function demoPhoto(id: string, caption: string, scene: "wall" | "unit" | "outdoor" | "pipes"): HubPhoto {
  const shapes: Record<typeof scene, string> = {
    wall: `<rect x="70" y="60" width="260" height="150" fill="#efeade"/><circle cx="270" cy="150" r="12" fill="#a3a8b4"/><rect x="110" y="95" width="120" height="14" rx="3" fill="#6e7482"/>`,
    unit: `<rect x="70" y="60" width="260" height="150" fill="#efeade"/><rect x="110" y="90" width="180" height="46" rx="10" fill="#ffffff" stroke="#a3a8b4" stroke-width="3"/><rect x="128" y="124" width="144" height="4" rx="2" fill="#a3a8b4"/>`,
    outdoor: `<rect x="0" y="190" width="400" height="110" fill="#bcd2e2"/><rect x="120" y="110" width="160" height="110" rx="8" fill="#ffffff" stroke="#6e7482" stroke-width="3"/><circle cx="185" cy="165" r="34" fill="none" stroke="#a3a8b4" stroke-width="6"/>`,
    pipes: `<rect x="70" y="60" width="260" height="150" fill="#efeade"/><path d="M110 100 H290 V200" fill="none" stroke="#f8f5ef" stroke-width="18" stroke-linejoin="round"/><path d="M110 100 H290 V200" fill="none" stroke="#a3a8b4" stroke-width="3"/>`,
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#dce7f0"/>${shapes[scene]}<rect x="12" y="12" width="150" height="26" rx="13" fill="#1d212b"/><text x="87" y="30" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle">DEMO illustration</text></svg>`;
  return { id, url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, caption, width: 400, height: 300 };
}
