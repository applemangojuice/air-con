import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, createProject, generateQuote, type Project, type ReadinessContext, type Survey } from "@aircon/domain";
import {
  BOARD_COLUMNS,
  cardFromProject,
  compareCards,
  filterCards,
  filtersFromParams,
  filtersToSearch,
  groupByColumn,
  isOverdue,
  matchesSearch,
  type BoardCard,
} from "../components/ops/board/board-model.ts";

/** Fictional DEMO home: no real data. */
const SURVEY: Survey = {
  postcode: "SW16 9ZZ",
  addressLine: "7 Demo Road",
  property: { type: "semi-detached", era: "1930-1950", bedrooms: 3, ownership: "owner" },
  rooms: [
    { id: "r1", name: "Main bedroom", type: "bedroom", size: "medium", floor: "first", glazing: "medium", orientation: "south", hasExternalWall: true, photos: [] },
  ],
  outdoor: { location: "ground-rear", photos: [] },
  electrics: { condition: "modern-spare-ways", photos: [] },
};

function project(mut: (p: Project) => void = () => {}): Project {
  const p = createProject({
    id: "33333333-de5e-4000-8000-000000000003",
    quoteId: "44444444-0000-4000-8000-000000000004",
    createdAt: "2026-10-01T09:00:00.000Z",
    customerName: "Robin Example (DEMO)",
    customerEmail: "robin@example.com",
    customerPhone: "07700 900123",
    survey: SURVEY,
    quote: generateQuote(SURVEY),
  });
  mut(p);
  return p;
}

const CTX: ReadinessContext = { today: "2026-10-19", settings: DEFAULT_SETTINGS, compliance: [], crew: [], openIssues: [] };

test("the board has the eight stages and a closed column", () => {
  assert.deepEqual(
    BOARD_COLUMNS.map((c) => c.id),
    ["price", "survey", "proposal", "booking", "kit", "install", "handover", "aftercare", "closed"],
  );
});

test("a new project: instant price, its next gate's blocker as the next action", () => {
  const card = cardFromProject(project(), CTX, { invoiceNumbers: ["DIH-0007"] });
  assert.equal(card.column, "price");
  assert.equal(card.outcode, "SW16");
  assert.equal(card.valueKind, "instant");
  assert.equal(card.gate, "survey-complete");
  assert.ok(card.blockers >= 1, "the survey isn't booked");
  assert.equal(card.nextAction.source, "readiness");
  assert.equal(card.nextAction.text, "Book your home survey");
  assert.equal(card.nextAction.owner, "Customer");
});

test("a set next action wins, with its owner and due date; contract value once accepted", () => {
  const p = project((x) => {
    x.nextAction = { text: "Call about parking", dueOn: "2026-10-18", ownerRole: "surveyor" };
    x.proposal = { ...x.proposal, status: "accepted", contractTotalPence: 612_000, acceptedAt: "2026-10-10T10:00:00Z" };
    x.money.contractTotalPence = 612_000;
    x.survey.status = "submitted";
  });
  const card = cardFromProject(p, CTX);
  assert.deepEqual(card.nextAction, { text: "Call about parking", dueOn: "2026-10-18", source: "set", owner: "Surveyor" });
  assert.equal(card.valueKind, "contract");
  assert.equal(card.valuePence, 612_000);
  assert.equal(card.column, "booking");
  assert.equal(isOverdue(card, "2026-10-19"), true);
  assert.equal(isOverdue(card, "2026-10-18"), false);
});

test("no readiness context: no blockers claimed", () => {
  const card = cardFromProject(project(), null);
  assert.equal(card.blockers, 0);
  assert.equal(card.nextAction.source, "none");
});

test("closed projects land in the closed column and are never overdue", () => {
  const card = cardFromProject(
    project((x) => {
      x.closure = { closed: true, closedAt: "2026-10-01T00:00:00Z", reason: "cancelled" };
      x.nextAction = { text: "Old", dueOn: "2026-01-01" };
    }),
    CTX,
  );
  assert.equal(card.column, "closed");
  assert.equal(card.closedReason, "cancelled");
  assert.equal(isOverdue(card, "2026-10-19"), false);
});

test("search: name, address, postcode with or without the space, ids, invoice, email, phone", () => {
  const card = cardFromProject(project((x) => (x.pilot = { number: 3, label: "Croydon semi" })), CTX, { invoiceNumbers: ["DIH-0007"] });
  for (const q of ["robin", "demo road", "sw16 9zz", "SW169ZZ", "33333333", "44444444-0000", "dih-0007", "DIH0007", "robin@example", "07700900123", "+44 7700 900123", "pilot 3", "croydon"]) {
    assert.ok(matchesSearch(card, q), `matches "${q}"`);
  }
  for (const q of ["morgan", "SE19", "DIH-0008"]) assert.ok(!matchesSearch(card, q), `doesn't match "${q}"`);
  assert.ok(matchesSearch(card, "  "), "an empty query matches everything");
});

test("filters: mine, pilots only, blocked only", () => {
  const base = cardFromProject(project(), CTX);
  const cards: BoardCard[] = [
    { ...base, id: "a", owner: { staffId: "me", name: "Me" }, blockers: 0 },
    { ...base, id: "b", pilot: { number: 1, label: "One" }, blockers: 2 },
    { ...base, id: "c", blockers: 1 },
  ];
  assert.deepEqual(filterCards(cards, { mine: true }, "me").map((c) => c.id), ["a"]);
  assert.deepEqual(filterCards(cards, { mine: true }).map((c) => c.id), [], "nobody signed in owns nothing");
  assert.deepEqual(filterCards(cards, { pilots: true }).map((c) => c.id), ["b"]);
  assert.deepEqual(filterCards(cards, { blocked: true }).map((c) => c.id), ["b", "c"]);
  assert.deepEqual(filterCards(cards, {}).map((c) => c.id), ["a", "b", "c"]);
});

test("columns order cards by due date, then pilot number, then most recent", () => {
  const base = cardFromProject(project(), CTX);
  const mk = (id: string, over: Partial<BoardCard>): BoardCard => ({ ...base, id, ...over });
  const cards = [
    mk("late", { updatedAt: "2026-10-01" }),
    mk("recent", { updatedAt: "2026-10-18" }),
    mk("pilot2", { pilot: { number: 2, label: "" } }),
    mk("pilot1", { pilot: { number: 1, label: "" } }),
    mk("due", { nextAction: { text: "x", dueOn: "2026-10-20", source: "set" } }),
  ];
  const grouped = groupByColumn(cards);
  assert.deepEqual(grouped.price.map((c) => c.id), ["due", "pilot1", "pilot2", "recent", "late"]);
  assert.equal(grouped.closed.length, 0);
  assert.equal(compareCards(cards[0]!, cards[0]!), 0);
});

test("filters survive the URL round trip", () => {
  const f = { q: "demo road", mine: true, pilots: false, blocked: true, view: "list" as const };
  const search = filtersToSearch(f);
  assert.equal(search, "?q=demo+road&mine=1&blocked=1&view=list");
  assert.deepEqual(filtersFromParams(new URLSearchParams(search)), f);
  assert.equal(filtersToSearch({ q: " ", view: "board" }), "");
  assert.deepEqual(filtersFromParams(new URLSearchParams("")), { q: "", mine: false, pilots: false, blocked: false, view: "board" });
});
