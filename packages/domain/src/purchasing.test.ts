import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogueItem } from "./catalogue.ts";
import type { DesignRecord } from "./design-record.ts";
import {
  UNKNOWN_SUPPLIER,
  advancePo,
  kitCustomerSummary,
  kitSummary,
  needOnSiteBy,
  orderByDate,
  poLineEffectiveQty,
  poSchedule,
  poTotals,
  posFromDesign,
  raiseReplacement,
  recordPoDelivery,
  recordPoInspection,
  shiftWorkingDays,
  updatePoDetails,
  type PurchaseOrder,
} from "./purchasing.ts";

const NOW = "2026-10-18T10:00:00.000Z";
const BY = "DEMO Ada";

const cat = (over: Partial<CatalogueItem> & Pick<CatalogueItem, "id" | "kind" | "label">): CatalogueItem => ({
  costPence: null,
  status: "available",
  confidence: "provisional",
  sources: [],
  active: true,
  ...over,
});

const CATALOGUE: CatalogueItem[] = [
  cat({ id: "in-25", kind: "indoor", label: "Indoor 25 (DEMO)", costPence: 38_000, supplier: "DEMO Aircon Supplies" }),
  cat({ id: "out-25", kind: "outdoor", label: "Outdoor 25 (DEMO)", costPence: 52_000, supplier: "DEMO Aircon Supplies" }),
  cat({ id: "pipe", kind: "material", label: "Line set (DEMO)", unit: "m", costPence: 900, supplier: "DEMO Trade Counter" }),
  cat({ id: "tape", kind: "material", label: "Tape (DEMO)", costPence: null, costSource: { supplier: "DEMO Trade Counter" } }),
  cat({ id: "mystery", kind: "material", label: "Bracket (DEMO)", costPence: 5_500 }),
];

const DESIGN: DesignRecord = {
  id: "d-1",
  projectId: "p-1",
  version: 2,
  status: "approved",
  rooms: [],
  overrides: [],
  createdAt: NOW,
  variants: [
    {
      id: "std",
      label: "Standard",
      tier: "standard",
      systems: [],
      roomUnits: [],
      rules: [],
      verdict: "needs-review",
      installDays: 3,
      bom: [
        { catalogueItemId: "pipe", sku: "pipe", label: "pipe", qty: 6.5, unit: "m", category: "materials" },
        { catalogueItemId: "in-25", sku: "in-25", label: "in", qty: 1, category: "equipment" },
        { catalogueItemId: "in-25", sku: "in-25", label: "in", qty: 1, category: "equipment" },
        { catalogueItemId: "out-25", sku: "out-25", label: "out", qty: 1, category: "equipment" },
        { catalogueItemId: "tape", sku: "tape", label: "tape", qty: 2, category: "consumables" },
        { catalogueItemId: "mystery", sku: "mystery", label: "bracket", qty: 1, category: "materials" },
        { sku: "free-text", label: "Cable ties", qty: 0, category: "consumables" },
      ],
    },
  ],
};

let n = 0;
const makeId = () => `id-${++n}`;
const pos = () => posFromDesign(DESIGN, "std", CATALOGUE, "p-1", makeId);
const bySupplier = (list: PurchaseOrder[], s: string) => list.find((p) => p.supplier === s)!;

test("purchase orders: one per supplier, equipment first, same item merged, expected costs from the catalogue", () => {
  const list = pos();
  assert.deepEqual(list.map((p) => p.supplier), ["DEMO Aircon Supplies", "DEMO Trade Counter", UNKNOWN_SUPPLIER]);
  const equipment = bySupplier(list, "DEMO Aircon Supplies");
  assert.deepEqual(equipment.lines.map((l) => [l.label, l.qty]), [
    ["Indoor 25 (DEMO)", 2],
    ["Outdoor 25 (DEMO)", 1],
  ]);
  assert.equal(equipment.expectedTotalPence, 2 * 38_000 + 52_000);
  assert.ok(list.every((p) => p.status === "required" && p.projectId === "p-1" && p.designVersion === 2));

  const trade = bySupplier(list, "DEMO Trade Counter");
  assert.equal(trade.lines.find((l) => l.catalogueItemId === "pipe")?.qty, 7, "rounded up to whole units");
  const tape = trade.lines.find((l) => l.catalogueItemId === "tape")!;
  assert.equal(tape.required, false, "consumables are van stock");
  assert.equal(tape.unitCostPence, null, "unpriced stays unpriced");
  assert.equal(poTotals(trade).unpricedLines, 1);
  assert.equal(trade.expectedTotalPence, 7 * 900, "unpriced lines aren't counted as free");
  assert.throws(() => posFromDesign(DESIGN, "nope", CATALOGUE, "p-1", makeId));
});

test("orders only move forward, and can't be placed without a named supplier", () => {
  const [po] = pos();
  const ordered = advancePo(po!, "ordered", BY, NOW, { reference: "SO-1" });
  assert.ok(ordered.ok);
  if (!ordered.ok) return;
  assert.equal(ordered.po.orderedOn, "2026-10-18");
  assert.equal(ordered.po.history.at(-1)?.status, "ordered");
  const back = advancePo(ordered.po, "approved", BY, NOW);
  assert.equal(back.ok, false);
  assert.equal(advancePo(ordered.po, "ordered", BY, NOW).ok, false, "already there");
  assert.equal(advancePo(po!, "ordered", "  ", NOW).ok, false, "a person records it");

  const unknown = pos().find((p) => p.supplier === UNKNOWN_SUPPLIER)!;
  assert.equal(advancePo(unknown, "ordered", BY, NOW).ok, false);
  assert.ok(advancePo(unknown, "ordered", BY, NOW, { supplier: "DEMO Brackets Ltd" }).ok);
});

test("confirmed needs the supplier's date; delivered needs a real time and everything here", () => {
  const ordered = advancePo(pos()[0]!, "ordered", BY, NOW);
  assert.ok(ordered.ok);
  if (!ordered.ok) return;
  assert.equal(advancePo(ordered.po, "confirmed", BY, NOW).ok, false);
  const confirmed = advancePo(ordered.po, "confirmed", BY, NOW, { eta: "2026-10-28" });
  assert.ok(confirmed.ok);
  if (!confirmed.ok) return;
  assert.equal(advancePo(confirmed.po, "delivered", BY, NOW, { deliveredAt: "2026-10-28T09:00:00.000Z" }).ok, false, "not in the future");
  const delivered = advancePo(confirmed.po, "delivered", BY, NOW);
  assert.ok(delivered.ok);
  if (!delivered.ok) return;
  assert.equal(delivered.po.deliveredBy, BY);
  assert.ok(delivered.po.lines.every((l) => l.receivedQty === l.qty));
  assert.equal(advancePo(delivered.po, "cancelled", BY, NOW, undefined, "Changed mind").ok, false, "arrived kit can't be cancelled");
});

test("an ETA passing never makes anything delivered", () => {
  const ordered = advancePo(pos()[0]!, "ordered", BY, NOW, { eta: "2026-10-10" });
  assert.ok(ordered.ok);
  if (!ordered.ok) return;
  const s = kitSummary([ordered.po]);
  assert.equal(s.deliveredLines, 0);
  assert.equal(s.status, "ordered");
  assert.ok(poSchedule(ordered.po, undefined, NOW).flags.includes("eta-passed"));
});

test("part deliveries accumulate; the order is delivered when every required line is in", () => {
  const trade = bySupplier(pos(), "DEMO Trade Counter");
  const ordered = advancePo(trade, "ordered", BY, NOW);
  assert.ok(ordered.ok);
  if (!ordered.ok) return;
  const pipe = ordered.po.lines.find((l) => l.catalogueItemId === "pipe")!;
  const part = recordPoDelivery(ordered.po, { by: "DEMO Ivo", received: [{ lineId: pipe.id, qty: 4 }] }, NOW);
  assert.ok(part.ok);
  if (!part.ok) return;
  assert.equal(part.po.status, "ordered", "still owed");
  assert.match(part.po.history.at(-1)!.note, /Part delivery/);
  assert.equal(kitSummary([part.po]).shortages, 1);
  assert.equal(recordPoDelivery(part.po, { by: "x", received: [{ lineId: pipe.id, qty: 4 }] }, NOW).ok, false, "more than ordered");
  const rest = recordPoDelivery(part.po, { by: "DEMO Ivo", received: [{ lineId: pipe.id, qty: 3 }] }, NOW);
  assert.ok(rest.ok);
  if (rest.ok) assert.equal(rest.po.status, "delivered", "the optional tape doesn't hold it up");
});

test("inspection: good and damaged per line, serials, damage reported back", () => {
  const delivered = advancePo(pos()[0]!, "delivered", BY, NOW);
  assert.ok(delivered.ok);
  if (!delivered.ok) return;
  const [indoor, outdoor] = delivered.po.lines;
  const r = recordPoInspection(
    delivered.po,
    {
      by: "DEMO Ivo",
      lines: [
        { lineId: indoor!.id, goodQty: 1, damagedQty: 1, serials: ["SN-1", " SN-1 ", "SN-2"] },
        { lineId: outdoor!.id, goodQty: 1, damagedQty: 0 },
      ],
    },
    NOW,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.po.status, "inspected");
  assert.deepEqual(r.po.lines[0]!.serials, ["SN-1", "SN-2"]);
  assert.deepEqual(r.newlyDamaged, [{ lineId: indoor!.id, label: "Indoor 25 (DEMO)", qty: 1 }]);
  const s = kitSummary([r.po]);
  assert.equal(s.damaged, 1);
  assert.equal(s.inspectedLines, 1, "the damaged line isn't good yet");
  assert.equal(s.status, "delivered");

  assert.equal(
    recordPoInspection(delivered.po, { by: "x", lines: [{ lineId: indoor!.id, goodQty: 3, damagedQty: 0 }] }, NOW).ok,
    false,
    "can't check more than arrived",
  );
});

test("a replacement order covers the damage, so the original line stops holding the kit", () => {
  const delivered = advancePo(pos()[0]!, "delivered", BY, NOW);
  assert.ok(delivered.ok);
  if (!delivered.ok) return;
  const [indoor, outdoor] = delivered.po.lines;
  const checked = recordPoInspection(
    delivered.po,
    { by: BY, lines: [{ lineId: indoor!.id, goodQty: 1, damagedQty: 1 }, { lineId: outdoor!.id, goodQty: 1, damagedQty: 0 }] },
    NOW,
  );
  assert.ok(checked.ok);
  if (!checked.ok) return;
  assert.equal(raiseReplacement(checked.po, indoor!.id, 2, makeId, BY, NOW).ok, false, "only one is damaged");
  const rep = raiseReplacement(checked.po, indoor!.id, 1, makeId, BY, NOW);
  assert.ok(rep.ok);
  if (!rep.ok) return;
  assert.equal(poLineEffectiveQty(rep.po.lines[0]!), 1);
  assert.equal(rep.replacement.status, "required");
  assert.equal(rep.replacement.lines[0]!.replacesLineId, indoor!.id);
  assert.equal(rep.replacement.replacementFor, checked.po.id);

  const before = kitSummary([rep.po, rep.replacement]);
  assert.equal(before.damaged, 0, "covered by the replacement");
  assert.equal(before.status, "not-ordered", "the replacement still has to be ordered");
  const arrived = advancePo(rep.replacement, "delivered", BY, NOW);
  assert.ok(arrived.ok);
  if (!arrived.ok) return;
  const ok = recordPoInspection(arrived.po, { by: BY, lines: [{ lineId: arrived.po.lines[0]!.id, goodQty: 1, damagedQty: 0 }] }, NOW);
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(kitSummary([rep.po, ok.po]).status, "inspected");
});

test("kit summary: least advanced order wins, expected date only when every order has one", () => {
  const [a, b] = pos();
  const ao = advancePo(a!, "confirmed", BY, NOW, { eta: "2026-10-27" });
  const bo = advancePo(b!, "ordered", BY, NOW);
  assert.ok(ao.ok && bo.ok);
  if (!ao.ok || !bo.ok) return;
  const s = kitSummary([ao.po, bo.po]);
  assert.equal(s.status, "ordered");
  assert.equal(s.expectedDate, undefined, "one order has no ETA");
  const bc = advancePo(bo.po, "confirmed", BY, NOW, { eta: "2026-10-29" });
  assert.ok(bc.ok);
  if (!bc.ok) return;
  const both = kitSummary([ao.po, bc.po]);
  assert.equal(both.status, "confirmed");
  assert.equal(both.expectedDate, "2026-10-29");
  assert.equal(kitSummary([]).status, "not-ordered");
  const cancelled = advancePo(a!, "cancelled", BY, NOW, undefined, "Wrong supplier");
  assert.ok(cancelled.ok);
  if (cancelled.ok) assert.equal(kitSummary([cancelled.po]).requiredLines, 0, "cancelled orders don't count");
});

test("details can change, the supplier can't once ordered", () => {
  const [po] = pos();
  const u = updatePoDetails(po!, { reference: "SO-9", eta: "2026-10-30" }, BY, NOW);
  assert.ok(u.ok);
  if (u.ok) assert.match(u.po.history.at(-1)!.note, /reference, ETA/);
  assert.equal(updatePoDetails(po!, { reference: undefined }, BY, NOW).ok, false, "nothing changed");
  const ordered = advancePo(po!, "ordered", BY, NOW);
  assert.ok(ordered.ok);
  if (ordered.ok) assert.equal(updatePoDetails(ordered.po, { supplier: "Other" }, BY, NOW).ok, false);
  assert.equal(updatePoDetails(po!, { eta: "soon" }, BY, NOW).ok, false);
});

test("order-by maths: need on site two working days before day 1, minus the lead time", () => {
  // Day 1 on Tue 3 Nov 2026: on site by Fri 30 Oct; 5 working days earlier is Fri 23 Oct.
  assert.equal(shiftWorkingDays("2026-11-03", -2), "2026-10-30");
  assert.equal(needOnSiteBy("2026-11-03"), "2026-10-30");
  assert.equal(orderByDate("2026-10-30", 5), "2026-10-23");
  assert.equal(shiftWorkingDays("2026-10-23", 1), "2026-10-26", "skips the weekend");
});

test("late flags against the install date", () => {
  const [po] = pos();
  const late = poSchedule(po!, "2026-10-27", "2026-10-20");
  assert.equal(late.needOnSiteBy, "2026-10-23");
  assert.equal(late.orderBy, "2026-10-16");
  assert.ok(late.flags.includes("order-late"));
  const soon = poSchedule(po!, "2026-11-10", "2026-10-29");
  assert.ok(soon.flags.includes("order-soon"));
  const ordered = advancePo(po!, "confirmed", BY, NOW, { eta: "2026-11-09" });
  assert.ok(ordered.ok);
  if (ordered.ok) assert.ok(poSchedule(ordered.po, "2026-11-10", "2026-10-29").flags.includes("eta-after-need"));
  assert.ok(poSchedule(po!, "2026-10-21", "2026-10-20").flags.includes("delivery-late"));
});

test("the customer line only says what's been recorded", () => {
  assert.equal(kitCustomerSummary({ requiredLines: 5, deliveredLines: 0, status: "confirmed" }), "");
  assert.equal(kitCustomerSummary({ requiredLines: 5, deliveredLines: 2, status: "ordered" }), "2 of 5 items delivered so far");
  assert.equal(kitCustomerSummary({ requiredLines: 5, deliveredLines: 5, status: "delivered" }), "");
});
