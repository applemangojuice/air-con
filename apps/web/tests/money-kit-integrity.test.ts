import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, mergeSettings, type Project, type PurchaseOrder, type StaffMember } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * Money and kit integrity on the real server modules, in-memory backend,
 * DEMO data: a retried payment never counts twice, the console's "owed to
 * us" nets credit notes, the deposit follows the contract not a later
 * settings change, and supply-and-install dates wait for the kit plus the
 * cancellation period (which runs from the day the kit really arrived).
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { finishPayment, issueInvoice, recordPayment } = await import("../lib/money-server.ts");
const { loadProject, loadReadinessContext, saveProject, londonToday } = await import("../lib/project-service.ts");
const { loadPulse } = await import("../lib/ops-core-server.ts");
const { loadBooking, setInstallDates } = await import("../lib/booking-server.ts");
const { recordActualCosts, syncKitStatus } = await import("../lib/purchasing-server.ts");
const paymentsRepo = await import("../lib/repo/payments.ts");
const purchaseOrdersRepo = await import("../lib/repo/purchaseOrders.ts");
const settingsRepo = await import("../lib/repo/settings.ts");
const { getSettings } = await import("../lib/settings-server.ts");

const OFFICE: StaffMember = { id: "aa000000-0000-4000-8000-0000000000c1", email: "office@demo.dang.invalid", name: "DEMO Office", roles: ["admin"], external: false, active: true, qualifications: [] };
const rid = () => crypto.randomUUID();

async function demo(label: string): Promise<string> {
  const summary = await resetDemoData({ now: new Date().toISOString() });
  return summary.projects.find((p) => p.label.startsWith(label))!.id;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test("a part-applied payment retried later is counted on the project once", async () => {
  const id = await demo("DEMO 3");
  const balance = await issueInvoice(id, { kind: "balance", requestId: rid() }, OFFICE);
  assert.ok(balance.ok, !balance.ok ? balance.error : "");
  const before = (await loadProject(id))!;
  const paid = await recordPayment(
    { projectId: id, invoiceId: balance.value.id, method: "bank-transfer", provider: "manual", providerRef: `manual:${rid()}`, amountPence: 10_000, status: "succeeded", receivedAt: new Date().toISOString() },
    OFFICE,
  );
  assert.ok(paid.ok, !paid.ok ? paid.error : "");
  const once = (await loadProject(id))!;
  assert.equal(once.money.paidPence, before.money.paidPence + 10_000);
  const stored = (await paymentsRepo.get(paid.value.payment.id))!;
  assert.ok(stored.recordedOnProjectAt, "marked as counted straight after");
  assert.equal(stored.pendingApply, undefined);

  // The function died after the totals moved but before anything was marked: retry it.
  const { recordedOnProjectAt: _r, appliedAt: _a, ...bare } = stored;
  void [_r, _a];
  await paymentsRepo.update({ ...bare, pendingApply: true });
  const retried = await finishPayment(id, stored.id, OFFICE);
  assert.ok(retried.ok);
  const after = (await loadProject(id))!;
  assert.equal(after.money.paidPence, once.money.paidPence, "the reducer refused the second count");
  assert.equal(after.events.filter((e) => e.type === "payment-recorded").length, once.events.filter((e) => e.type === "payment-recorded").length);
  assert.equal((await paymentsRepo.get(stored.id))!.pendingApply, undefined, "and the payment is finished");
});

test("the console's 'owed to us' leaves out an invoice that was credited", async () => {
  const id = await demo("DEMO 3");
  const balance = await issueInvoice(id, { kind: "balance", requestId: rid() }, OFFICE);
  assert.ok(balance.ok);
  const owing = await loadPulse();
  const line = owing.outstanding.invoices.find((i) => i.number === balance.value.number);
  assert.equal(line?.duePence, balance.value.totalPence);

  const credit = await issueInvoice(
    id,
    { kind: "credit-note", amountPence: balance.value.totalPence, reason: "Cancel what's unpaid (DEMO)", creditsInvoiceId: balance.value.id, requestId: rid() },
    OFFICE,
  );
  assert.ok(credit.ok, !credit.ok ? credit.error : "");
  const pulse = await loadPulse();
  assert.equal(pulse.outstanding.invoices.some((i) => i.projectId === id), false);
  assert.equal(pulse.outstanding.pence, owing.outstanding.pence - balance.value.totalPence);
});

test("the deposit follows the contract's frozen terms, not a settings change made after acceptance", async () => {
  const id = await demo("DEMO 3");
  const ctx = (await loadReadinessContext(id))!;
  const agreed = ctx.agreedPayments!;
  assert.ok(agreed, "an accepted contract carries its payment schedule");
  // An admin changes the deposit afterwards: the contract's figure still rules.
  const live = await getSettings();
  await settingsRepo.setValue(settingsRepo.PILOT_SETTINGS_KEY, mergeSettings({ ...live, payments: { ...live.payments, depositPct: agreed.depositPct === 0 ? 30 : 0 } }), "test");
  const later = (await loadReadinessContext(id))!;
  assert.deepEqual(later.agreedPayments, agreed);
  const view = (await loadBooking(id, OFFICE))!;
  assert.equal(view.payments.depositPct, agreed.depositPct);
  assert.equal(view.paymentsAgreed, true);
});

/** DEMO 3 put back to "accepted, not booked, no early start, kit ordered but not here", for the date rules. */
async function waitingOnKit(): Promise<{ id: string; pos: PurchaseOrder[] }> {
  const id = await demo("DEMO 3");
  const p = (await loadProject(id))!;
  const reset: Project = {
    ...p,
    proposal: { ...p.proposal, earlyStart: undefined, earlyStartRequested: false, goodsReceivedOn: undefined, cancellationEndsOn: undefined },
    booking: { ...p.booking, status: "not-booked", dates: [], startDate: undefined },
    kit: { ...p.kit, status: "ordered", deliveredAt: undefined, inspectedAt: undefined, deliveredTo: undefined },
  };
  assert.ok(await saveProject(reset));
  const pos = await purchaseOrdersRepo.listForProject(id);
  for (const po of pos) {
    await purchaseOrdersRepo.update({
      ...po,
      status: "confirmed",
      eta: addDays(londonToday(), 7),
      deliveredAt: undefined,
      inspectedAt: undefined,
      lines: po.lines.map((l) => ({ ...l, receivedQty: 0, inspectedQty: 0, damagedQty: 0 })),
    });
  }
  return { id, pos: await purchaseOrdersRepo.listForProject(id) };
}

test("ops can't set install dates the cancellation period would refuse on day 1", async () => {
  const { id } = await waitingOnKit();
  await settingsRepo.setValue(settingsRepo.PILOT_SETTINGS_KEY, mergeSettings(DEFAULT_SETTINGS), "test");
  const today = londonToday();
  // The kit is due in 7 days; the period then runs 14 more: anything before that is refused, with the date.
  const view = (await loadBooking(id, OFFICE))!;
  assert.ok(view.earliestStart > addDays(today, 7 + 14), `earliest ${view.earliestStart}`);
  const tooSoon = await setInstallDates(id, nextWeekday(addDays(today, 10)), OFFICE);
  assert.equal(tooSoon.ok, false);
  assert.match(!tooSoon.ok ? tooSoon.error : "", /No early start was requested.*the earliest start is/);
  const fine = await setInstallDates(id, view.earliestStart, OFFICE);
  assert.ok(fine.ok, !fine.ok ? fine.error : "");
});

test("kit that reaches the customer's home before the booking starts the period on the day it arrived", async () => {
  const { id, pos } = await waitingOnKit();
  const arrived = new Date(Date.now() - 3 * 86_400_000).toISOString();
  for (const po of pos) {
    await purchaseOrdersRepo.update({
      ...po,
      status: "delivered",
      deliveredAt: arrived,
      lines: po.lines.map((l) => ({ ...l, receivedQty: l.qty })),
    });
  }
  const sync = await syncKitStatus(id, OFFICE);
  assert.equal(sync.changed, true, sync.warning);
  const p = (await loadProject(id))!;
  assert.equal(p.booking.status, "not-booked");
  const londonDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(arrived));
  assert.equal(p.proposal.goodsReceivedOn, londonDay, "the delivery day, not today");
  assert.match(p.events.at(-1)!.label, /Your equipment has been delivered to your home\. Your cancellation period now runs until the end of/);
  assert.equal((await syncKitStatus(id, OFFICE)).changed, false, "once");
});

test("actual costs go in per line on a placed order and feed the pilot's numbers", async () => {
  const { id, pos } = await waitingOnKit();
  const po = pos[0]!;
  const line = po.lines[0]!;
  const r = await recordActualCosts(id, po.id, [{ lineId: line.id, actualUnitCostPence: 41_000 }], OFFICE);
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.equal((await purchaseOrdersRepo.get(po.id))!.lines[0]!.actualUnitCostPence, 41_000);
  const elsewhere = await recordActualCosts("aa000000-0000-4000-8000-000000000999", po.id, [{ lineId: line.id, actualUnitCostPence: 1 }], OFFICE);
  assert.equal(elsewhere.ok, false, "only on its own project");
});

function nextWeekday(iso: string): string {
  let d = iso;
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}
