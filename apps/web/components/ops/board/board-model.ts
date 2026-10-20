import {
  GATE_LABEL,
  PROJECT_STAGES,
  ROLE_LABEL,
  STAGE_INFO,
  blockersFor,
  currentStage,
  nextGate,
  outcodeOf,
  type Blocker,
  type GateId,
  type Project,
  type ProjectStageId,
  type ReadinessContext,
  type StaffRole,
} from "@aircon/domain";

/**
 * The board's view of a project, and the filters over it. Pure: the server
 * builds the cards (lib/ops-core-server.ts loadBoard), the client filters
 * and searches them instantly, and tests pin the rules.
 */

export type BoardColumnId = ProjectStageId | "closed";

export const BOARD_COLUMNS: { id: BoardColumnId; label: string }[] = [
  ...PROJECT_STAGES.map((id) => ({ id, label: STAGE_INFO[id].label })),
  { id: "closed", label: "Closed" },
];

export interface BoardCard {
  id: string;
  quoteId: string;
  customer: string;
  addressLine: string;
  postcode: string;
  outcode: string;
  email?: string;
  phone?: string;
  column: BoardColumnId;
  /** The contract total once accepted, else the instant price. */
  valuePence: number;
  valueKind: "contract" | "instant";
  pilot?: { number: number; label: string };
  demo: boolean;
  nextAction: { text: string; dueOn?: string; source: "set" | "readiness" | "none"; owner?: string };
  owner?: { staffId: string; name: string };
  /** The next gate the project has to clear, and what stands in its way. */
  gate: GateId | null;
  gateLabel?: string;
  blockers: number;
  warnings: number;
  topBlocker?: string;
  invoiceNumbers: string[];
  /** The survey slot (UK wall-clock as UTC) while one is booked. */
  surveyAt?: string;
  /** Booked, and nobody is down to do it (a slot the family picked themselves, say). */
  surveyUnassigned?: boolean;
  installDates: string[];
  closedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export function ownerLabel(owner: Blocker["owner"]): string {
  if (owner === "customer") return "Customer";
  if (owner === "ops") return "Ops";
  return ROLE_LABEL[owner as StaffRole] ?? String(owner);
}

/**
 * The card's next action: the one someone set, else the top blocker's
 * action for the next gate (who and what), else nothing.
 */
export function cardNextAction(project: Project, gateBlockers: Blocker[]): BoardCard["nextAction"] {
  const set = project.nextAction;
  if (set?.text) {
    return {
      text: set.text,
      ...(set.dueOn ? { dueOn: set.dueOn } : {}),
      source: "set",
      ...(set.ownerRole ? { owner: set.ownerRole === "customer" ? "Customer" : ROLE_LABEL[set.ownerRole] } : {}),
    };
  }
  const top = gateBlockers.find((b) => b.severity === "block") ?? gateBlockers[0];
  if (top) return { text: top.action ?? top.message, source: "readiness", owner: ownerLabel(top.owner) };
  return { text: project.closure.closed ? "Closed" : "Nothing waiting", source: "none" };
}

/** One card from a project and its readiness context. */
export function cardFromProject(
  project: Project,
  ctx: ReadinessContext | null,
  extras: { invoiceNumbers?: string[]; demo?: boolean; updatedAt?: string } = {},
): BoardCard {
  const p = project;
  const gate = nextGate(p);
  let gateBlockers: Blocker[] = [];
  if (gate && ctx) {
    try {
      gateBlockers = blockersFor(p, ctx, gate);
    } catch (err) {
      console.error(`[board] readiness for ${p.id} failed:`, err);
    }
  }
  const blocks = gateBlockers.filter((b) => b.severity === "block");
  const warns = gateBlockers.filter((b) => b.severity === "warn");
  const accepted = p.proposal.status === "accepted" && (p.money.contractTotalPence ?? p.proposal.contractTotalPence) !== undefined;
  const installDates = p.install.days.length ? p.install.days.map((d) => d.date) : p.booking.status === "booked" ? p.booking.dates : [];
  return {
    id: p.id,
    quoteId: p.quoteId,
    customer: p.customer.name || "Unnamed customer",
    addressLine: p.customer.addressLine,
    postcode: p.customer.postcode,
    outcode: p.customer.postcode ? outcodeOf(p.customer.postcode) : "",
    ...(p.customer.email ? { email: p.customer.email } : {}),
    ...(p.customer.phone ? { phone: p.customer.phone } : {}),
    column: p.closure.closed ? "closed" : currentStage(p),
    valuePence: accepted ? (p.money.contractTotalPence ?? p.proposal.contractTotalPence)! : Math.round(p.quoteSummary.totalGbp * 100),
    valueKind: accepted ? "contract" : "instant",
    ...(p.pilot ? { pilot: p.pilot } : {}),
    demo: extras.demo ?? false,
    nextAction: cardNextAction(p, gateBlockers),
    ...(p.owner ? { owner: p.owner } : {}),
    gate,
    ...(gate ? { gateLabel: GATE_LABEL[gate] } : {}),
    blockers: blocks.length,
    warnings: warns.length,
    ...(blocks[0] ? { topBlocker: blocks[0].message } : {}),
    invoiceNumbers: extras.invoiceNumbers ?? [],
    ...(p.survey.status === "booked" && p.survey.scheduledFor ? { surveyAt: p.survey.scheduledFor } : {}),
    ...(!p.closure.closed && p.survey.status === "booked" && !p.survey.surveyor ? { surveyUnassigned: true } : {}),
    installDates,
    ...(p.closure.reason ? { closedReason: p.closure.reason } : {}),
    createdAt: p.createdAt,
    updatedAt: extras.updatedAt ?? p.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Filters + search                                                    */
/* ------------------------------------------------------------------ */

export interface BoardFilters {
  q?: string;
  mine?: boolean;
  pilots?: boolean;
  blocked?: boolean;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Every word of the query must match somewhere: name, address, postcode
 * (with or without its space), project or quote id (or their start),
 * invoice number, email or phone.
 */
export function matchesSearch(card: BoardCard, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [
    card.customer,
    card.addressLine,
    card.postcode,
    card.id,
    card.quoteId,
    card.email ?? "",
    card.pilot ? `pilot ${card.pilot.number} ${card.pilot.label}` : "",
    ...card.invoiceNumbers,
  ]
    .join(" ")
    .toLowerCase();
  const squashed = squash(haystack);
  const phone = (card.phone ?? "").replace(/\D/g, "");
  return words.every((w) => {
    if (haystack.includes(w)) return true;
    const sw = squash(w);
    if (sw && squashed.includes(sw)) return true;
    const digits = w.replace(/\D/g, "");
    return digits.length >= 4 && phone.includes(digits.replace(/^44/, "").replace(/^0/, ""));
  });
}

export function filterCards(cards: BoardCard[], filters: BoardFilters, me?: string): BoardCard[] {
  return cards.filter(
    (c) =>
      (!filters.mine || (me !== undefined && c.owner?.staffId === me)) &&
      (!filters.pilots || c.pilot !== undefined) &&
      (!filters.blocked || c.blockers > 0) &&
      matchesSearch(c, filters.q ?? ""),
  );
}

/** Cards per column, each column ordered: due soonest, then pilots by number, then most recently touched. */
export function groupByColumn(cards: BoardCard[]): Record<BoardColumnId, BoardCard[]> {
  const out = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, [] as BoardCard[]])) as Record<BoardColumnId, BoardCard[]>;
  for (const c of cards) out[c.column].push(c);
  for (const list of Object.values(out)) list.sort(compareCards);
  return out;
}

export function compareCards(a: BoardCard, b: BoardCard): number {
  const da = a.nextAction.dueOn ?? "9999";
  const db = b.nextAction.dueOn ?? "9999";
  if (da !== db) return da < db ? -1 : 1;
  const pa = a.pilot?.number ?? Number.MAX_SAFE_INTEGER;
  const pb = b.pilot?.number ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** Is the card's next action past its due date? */
export function isOverdue(card: Pick<BoardCard, "nextAction" | "column">, today: string): boolean {
  return card.column !== "closed" && Boolean(card.nextAction.dueOn && card.nextAction.dueOn < today);
}

/** Filters to and from the URL, so a refresh (or a shared link) keeps them. */
export function filtersFromParams(params: { get(key: string): string | null }): BoardFilters & { view: "board" | "list" } {
  return {
    q: params.get("q") ?? "",
    mine: params.get("mine") === "1",
    pilots: params.get("pilots") === "1",
    blocked: params.get("blocked") === "1",
    view: params.get("view") === "list" ? "list" : "board",
  };
}

export function filtersToSearch(f: BoardFilters & { view?: "board" | "list" }): string {
  const s = new URLSearchParams();
  if (f.q?.trim()) s.set("q", f.q.trim());
  if (f.mine) s.set("mine", "1");
  if (f.pilots) s.set("pilots", "1");
  if (f.blocked) s.set("blocked", "1");
  if (f.view === "list") s.set("view", "list");
  const out = s.toString();
  return out ? `?${out}` : "";
}
