import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyProjectAction,
  createProject,
  currentStage,
  customerNextAction,
  generateQuote,
  type ProjectAction,
  type StaffMember,
  type Survey,
} from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

registerAppResolver();

const demo = await import("../components/portal/demo.ts");
const schedule = await import("../components/portal/schedule.ts");

const SURVEY: Survey = {
  postcode: "SW4 7AA",
  addressLine: "12 Larkhall Rise",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms: [
    { id: "r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] },
    { id: "r2", name: "Living room", type: "living-room", size: "large", floor: "ground", glazing: "high", orientation: "west", hasExternalWall: true, photos: [] },
  ],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Drive the demo's reducer the way /p/demo's buttons do: customer actions without an actor, ours with a DEMO team member. */
function journey(early: boolean) {
  const start = Date.parse("2026-10-19T09:00:00.000Z");
  const project = createProject({
    id: "demo",
    quoteId: "demo",
    createdAt: new Date(start).toISOString(),
    customerName: "Alex Morgan (DEMO)",
    customerEmail: "alex.morgan@example.com",
    survey: SURVEY,
    quote: generateQuote(SURVEY),
    installDays: 3,
  });
  let s = { project, now: start, issues: [], invoices: [] as { id: string; kind: string; status: string; totalPence: number; paidPence: number; number: string }[], documents: [], photos: {} };
  const act = (action: ProjectAction, actor?: StaffMember, at?: number) => {
    const now = at ?? s.now + MIN;
    const r = applyProjectAction(s.project, action, new Date(now).toISOString(), demo.demoContext({ ...s, now } as never, actor));
    assert.ok(r.ok, `${action.type}: ${r.ok ? "" : r.error}`);
    s = { ...s, project: r.ok ? r.project : s.project, now };
  };
  const T = demo.DEMO_TEAM;
  const today = () => new Date(s.now).toISOString().slice(0, 10);

  const days = schedule.surveySlotDays({ settings: demo.DEMO_SETTINGS, nowWall: new Date(s.now).toISOString(), taken: [] });
  act({ type: "book-survey", scheduledFor: days[1]!.slots[0]!.iso, mode: "in-person" });
  act({ type: "documents-consent-recorded", channel: "portal" });
  act({ type: "assign-surveyor", staffId: T.surveyor.id, name: T.surveyor.name }, T.surveyor);
  act({ type: "survey-started", by: T.surveyor.name }, T.surveyor, s.now + DAY);
  act({ type: "survey-submitted", surveyRecordId: "demo-survey" }, T.surveyor);
  act({ type: "design-updated", designId: "d", version: 1, status: "in-review" }, T.techLead);
  act({ type: "design-approved", designId: "d", version: 1, by: T.techLead.name }, T.techLead);
  act({ type: "proposal-issued", proposalId: "p", version: 1, validUntil: schedule.addDays(today(), 30), optionCount: 1 }, T.surveyor);
  act({ type: "pre-contract-info-sent", proposalId: "p", demo: true });
  assert.equal(customerNextAction(s.project)?.label, "Review your proposal");
  act({ type: "proposal-accepted", proposalId: "p", version: 1, optionLabel: "Standard", contractTotalPence: 450_000, earlyStartRequested: early });
  act({ type: "contract-confirmation-sent", demo: true });

  // Deposit (DEMO settings ask for 20%).
  act({ type: "deposit-requested", amountPence: 90_000 }, T.surveyor);
  act({ type: "invoice-issued", amountPence: 90_000 }, T.surveyor);
  s.invoices = [{ id: "i1", kind: "deposit", status: "issued", totalPence: 90_000, paidPence: 0, number: "DEMO-0001" }];
  act({ type: "payment-recorded", amountPence: 90_000 });
  act({ type: "deposit-paid", amountPence: 90_000 });
  s.invoices = [{ ...s.invoices[0]!, status: "paid", paidPence: 90_000 }];

  const blocks = schedule.installBlockOptions({ project: s.project, settings: demo.DEMO_SETTINGS, today: today(), booked: [] });
  assert.ok(blocks.length > 0, "install blocks on offer");
  const block = blocks[0]!;
  act({ type: "install-dates-set", startDate: block.startDate, dates: block.dates });
  act(
    {
      type: "crew-assigned",
      crew: [
        { staffId: T.installer.id, name: T.installer.name, role: "installer", external: false },
        { staffId: T.techLead.id, name: T.techLead.name, role: "tech-lead", external: false },
        { staffId: T.electrician.id, name: T.electrician.name, role: "electrician", external: false },
      ],
    },
    T.surveyor,
  );
  if (early) act({ type: "early-start-evidenced", channel: "email", evidenceRef: "DEMO-EMAIL-1", by: T.surveyor.name }, T.surveyor);
  act({ type: "booking-confirmed" }, T.surveyor);
  act({ type: "kit-updated", status: "ordered", shortages: 0 }, T.surveyor);
  act({ type: "kit-updated", status: "confirmed", expectedDate: today(), shortages: 0 }, T.surveyor);
  act({ type: "kit-updated", status: "delivered", shortages: 0 }, T.surveyor);

  // Install days, on the booked dates.
  const at = (date: string, hh: number) => Date.parse(`${date}T${String(hh).padStart(2, "0")}:00:00.000Z`);
  act({ type: "kit-updated", status: "inspected", shortages: 0 }, T.installer, at(block.dates[0]!, 7));
  for (const [i, date] of block.dates.entries()) {
    act({ type: "install-day-started", n: i + 1, by: T.installer.name }, T.installer, at(date, 8));
    act({ type: "install-day-ended", n: i + 1, summary: "x", customerUpdate: { text: `Day ${i + 1} done`, mediaIds: [] } }, T.installer, at(date, 16));
  }
  act({ type: "install-completed" }, T.installer);
  act({ type: "commissioning-signed", by: T.techLead.name }, T.techLead);
  act({ type: "handover-pack-published", documentId: "pack" }, T.techLead);
  act({ type: "handover-signed", name: "Alex Morgan", outcome: "all-good", snagCount: 0 }, T.installer);
  act({ type: "invoice-issued", amountPence: 360_000 }, T.surveyor);
  s.invoices = [...s.invoices, { id: "i2", kind: "balance", status: "paid", totalPence: 360_000, paidPence: 360_000, number: "DEMO-0002" }];
  act({ type: "payment-recorded", amountPence: 360_000 });
  act({ type: "electrical-cert-updated", status: "received" }, T.surveyor);
  act({ type: "warranty-registered" }, T.surveyor);
  act({ type: "project-closed" }, T.surveyor);
  return s;
}

test("the demo plays end to end through the real reducer, with and without an early start", () => {
  for (const early of [false, true]) {
    const s = journey(early);
    assert.equal(s.project.closure.closed, true);
    assert.equal(currentStage(s.project), "aftercare");
    const view = demo.demoHubData(s as never);
    assert.equal(view.viewer.kind, "demo");
    assert.equal(view.money.outstandingPence, 0);
    assert.ok(view.project.events.every((e) => !e.internal), "the demo view is customer-safe too");
  }
});

test("without an early start, the first install block clears the cancellation period once the kit arrives", () => {
  const s = journey(false);
  const ends = s.project.proposal.cancellationEndsOn!;
  assert.ok(s.project.booking.dates[0]! > ends, `install ${s.project.booking.dates[0]} starts after the period (${ends})`);
});

test("the demo labels its people and pictures as DEMO", () => {
  for (const person of Object.values(demo.DEMO_TEAM)) assert.match(person.name, /\(DEMO\)/);
  const photo = demo.demoPhoto("x", "caption", "wall");
  assert.match(decodeURIComponent(photo.url ?? ""), /DEMO illustration/);
});
