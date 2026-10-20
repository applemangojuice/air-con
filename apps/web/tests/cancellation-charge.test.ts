import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * The charge for work done before a cancellation (CCR reg 36(4), §K45):
 * recorded by the office after an evidenced early start, invoiced, with what
 * the family paid held against it and the rest refunded, and the same
 * numbers on the money page, their page, the pay page and the email. Real
 * modules, in-memory backend, DEMO data.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
registerAppResolver();
const domain = await import("@aircon/domain");
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { demoId } = await import("../lib/demo-seed/ids.ts");
const { DEMO_STAFF } = await import("../lib/auth/demo-staff.ts");
const { recordCancellation, recordCancellationCharge } = await import("../lib/cancellation-server.ts");
const { loadProject, saveProject, londonToday } = await import("../lib/project-service.ts");
const { issueInvoice, loadMoney, payableInvoices, recordRefund } = await import("../lib/money-server.ts");
const { loadHub } = await import("../lib/portal-server.ts");
const { money } = await import("../lib/format.ts");
const { cancelledCopy } = await import("../components/portal/view.ts");
const { payHeadline } = await import("../app/p/[id]/pay/headline.ts");
const invoicesRepo = await import("../lib/repo/invoices.ts");
const issuesRepo = await import("../lib/repo/issues.ts");
const messagesRepo = await import("../lib/repo/messages.ts");
const paymentsRepo = await import("../lib/repo/payments.ts");

const DEMO3 = demoId("demo3:project");
const DEMO3_CUSTOMER = demoId("demo3:customer");
const BASIS = "DEMO: day 1 of 3 done (holes drilled and sealed, brackets fixed): a third of the labour, none of the equipment.";
const hourAgo = () => new Date(Date.now() - 3600_000).toISOString();

/** DEMO 3 (deposit paid) as if they'd asked to start early, it was evidenced, and day 1 had begun: then they cancel. */
async function cancelledAfterEarlyWork(opts: { evidenced?: boolean } = {}) {
  await resetDemoData({ now: new Date().toISOString() });
  const p = (await loadProject(DEMO3))!;
  const startedAt = new Date(Date.now() - 6 * 3600_000).toISOString();
  p.proposal.earlyStart = {
    requested: true,
    requestedAt: p.proposal.acceptedAt,
    channel: "email",
    wordingVersion: domain.EARLY_START_WORDING_VERSION,
    ...(opts.evidenced === false ? {} : { evidencedAt: p.proposal.acceptedAt, evidenceRef: "DEMO email: please start early", mediaIds: ["demo-media"], receivedOn: londonToday(), recordedBy: "DEMO Admin" }),
  };
  p.proposal.earlyStartRequested = true;
  p.proposal.preContractInfoSentAt ??= p.proposal.acceptedAt;
  p.install.status = "in-progress";
  p.install.startedAt = startedAt;
  p.install.days = [{ n: 1, date: londonToday(), status: "in-progress", startedAt }];
  assert.ok(await saveProject(p));
  const r = await recordCancellation(DEMO3, { receivedAt: hourAgo(), channel: "email", evidenceRef: "DEMO email: 'please stop'" }, DEMO_STAFF.admin);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.project.cancellation?.withinPeriod, true);
  return r.project;
}

test("a charge below what they paid: their payments become credit against it, the rest is the refund, the same numbers everywhere", async () => {
  const before = await cancelledAfterEarlyWork();
  const paid = before.money.paidPence;
  assert.ok(paid > 0, "DEMO 3 paid a deposit");
  const deposit = (await invoicesRepo.listForProject(DEMO3)).find((i) => i.kind === "deposit" && i.paidPence > 0)!;
  const chargePence = Math.round(paid / 3);
  const requestId = `demo-charge-${crypto.randomUUID()}`;

  const r = await recordCancellationCharge(DEMO3, { amountPence: chargePence, basis: BASIS, requestId }, DEMO_STAFF.admin);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(
    { charge: r.settlement.chargePence, paid: r.settlement.paidPence, refund: r.settlement.refundDuePence, owed: r.settlement.owedPence },
    { charge: chargePence, paid, refund: paid - chargePence, owed: 0 },
  );

  // The books: the deposit credited in full (the cancelled contract earns nothing), the charge invoiced and covered.
  const all = await invoicesRepo.listForProject(DEMO3);
  const credit = all.find((i) => i.kind === "credit-note" && i.creditsInvoiceId === deposit.id)!;
  assert.equal(credit.totalPence, -deposit.totalPence);
  assert.equal(credit.creditPurpose, "reduction");
  const charge = all.find((i) => i.kind === "cancellation-charge")!;
  assert.equal(charge.totalPence, chargePence);
  assert.equal(charge.reason, BASIS);
  assert.match(charge.lines[0]!.label, /^Work done before you cancelled: DEMO: day 1 of 3/);
  assert.equal(domain.invoiceOutstanding(charge, all), 0, "what they paid covers it");
  assert.equal(domain.outstandingPence(all), -(paid - chargePence), "in credit by exactly the refund");
  assert.ok(charge.documentId, "a printable invoice in their documents");
  assert.equal(r.project.cancellation?.charge?.amountPence, chargePence);

  // The family's page and pay page: the charge, what they paid, the refund and its date.
  const project = (await loadProject(DEMO3))!;
  const copy = cancelledCopy(project)!;
  assert.match(copy.body, new RegExp(`charge for the work done before you cancelled is ${esc(money(chargePence))}`));
  assert.match(copy.body, new RegExp(`we'll refund ${esc(money(paid - chargePence))} by`));
  assert.match(copy.body, /isn't part of the charge/, "the equipment isn't charged for");
  assert.equal(domain.customerNextAction(project), null, "nothing for them to pay");
  const hub = (await loadHub(DEMO3, { kind: "customer", customerId: DEMO3_CUSTOMER }))!;
  assert.equal(hub.money.outstandingPence, -(paid - chargePence), "their page: in credit by the refund, nothing to pay");
  assert.deepEqual(payableInvoices(all).filter((i) => i.kind === "cancellation-charge"), [], "nothing payable");
  const pay = payHeadline({ first: "Sam", cancelled: true, payableCount: 0, paidSomething: true, cancellation: project.cancellation!, workedEarly: true, settlement: domain.cancellationSettlement(project) });
  assert.match(pay.nothingDue, new RegExp(`We'll refund the other ${esc(money(paid - chargePence))}`));

  // Their email: the charge, the basis, what they paid, the refund; and the equipment kept apart.
  const messages = await messagesRepo.listForProject(DEMO3);
  const email = messages.find((m) => m.event === "cancellation-confirmed" && /the charge for the work done/.test(m.subject ?? ""))!;
  assert.ok(email, "the charge email");
  assert.match(email.bodyText, new RegExp(esc(money(chargePence))));
  assert.match(email.bodyText, /How we worked it out: DEMO: day 1 of 3/);
  assert.match(email.bodyText, new RegExp(`We'll refund: ${esc(money(paid - chargePence))}`));
  assert.match(email.bodyText, /for the work only, not the equipment/);
  assert.equal(messages.filter((m) => m.event === "invoice-issued" && m.bodyText.includes(charge.number)).length, 0, "not a generic 'pay this invoice' email");
  assert.ok(messages.some((m) => m.event === "team-alert" && /Charge for work done recorded/.test(m.subject ?? "")));

  // The refund task now has the new figure; the old one is closed with the reason.
  const issues = await issuesRepo.listForProject(DEMO3);
  const old = issues.find((i) => /^Refund £/.test(i.title) && !i.title.includes("after the charge"));
  if (old) assert.equal(old.status, "closed");
  const fresh = issues.find((i) => i.title.includes("(after the charge"))!;
  assert.match(fresh.title, new RegExp(`^Refund ${esc(money(paid - chargePence))} by`));

  // The money page shows the same.
  const view = (await loadMoney(DEMO3))!;
  assert.equal(view.summary.outstandingPence, -(paid - chargePence));

  // Again with the same form: nothing doubles. Another charge: refused.
  const again = await recordCancellationCharge(DEMO3, { amountPence: chargePence, basis: BASIS, requestId }, DEMO_STAFF.admin);
  assert.ok(again.ok);
  assert.equal((await invoicesRepo.listForProject(DEMO3)).length, all.length);
  assert.equal((await issuesRepo.listForProject(DEMO3)).length, issues.length);
  const second = await recordCancellationCharge(DEMO3, { amountPence: 100, basis: BASIS, requestId: `demo-other-${crypto.randomUUID()}` }, DEMO_STAFF.admin);
  assert.ok(!second.ok && /already recorded/.test(second.error));
  const direct = await issueInvoice(DEMO3, { kind: "cancellation-charge" }, DEMO_STAFF.admin);
  assert.ok(!direct.ok && /already invoiced/.test(direct.error));

  // The refund of the rest, against what they paid: no extra credit note, and nothing left either way.
  const refund = await recordRefund(
    DEMO3,
    { invoiceId: deposit.id, amountPence: paid - chargePence, method: "bank-transfer", refundedOn: londonToday(), reason: "DEMO: the rest after the charge", requestId: crypto.randomUUID() },
    DEMO_STAFF.admin,
  );
  assert.ok(refund.ok, JSON.stringify(refund));
  assert.equal(refund.value.creditNote, undefined, "already credited: no second credit note");
  const after = await invoicesRepo.listForProject(DEMO3);
  assert.equal(domain.outstandingPence(after), 0);
  assert.equal(domain.invoiceOutstanding(after.find((i) => i.kind === "cancellation-charge")!, after), 0);
  const settled = (await loadProject(DEMO3))!;
  assert.deepEqual(
    { refund: domain.cancellationSettlement(settled)!.refundDuePence, owed: domain.cancellationSettlement(settled)!.owedPence },
    { refund: 0, owed: 0 },
  );
  assert.match(cancelledCopy(settled)!.body, /which covers it: there's nothing more to pay or refund/);

  // The pilot's revenue is the charge, net of VAT: never the contract.
  const metrics = domain.pilotMetrics({ project: settled, purchaseOrders: [], time: [], issues: [], messagesSent: 0, invoices: after });
  assert.equal(metrics.revenuePence, charge.netPence);
  assert.equal(metrics.cancelled, true);
});

test("a charge above what they paid: the rest is on their pay page, their next step, and payable by card", async () => {
  const before = await cancelledAfterEarlyWork();
  const paid = before.money.paidPence;
  const chargePence = paid + 12_345;
  const r = await recordCancellationCharge(DEMO3, { amountPence: chargePence, basis: BASIS, requestId: `demo-charge-${crypto.randomUUID()}` }, DEMO_STAFF.admin);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.settlement.owedPence, 12_345);
  const all = await invoicesRepo.listForProject(DEMO3);
  const charge = all.find((i) => i.kind === "cancellation-charge")!;
  assert.equal(domain.invoiceOutstanding(charge, all), 12_345, "the invoice asks for exactly what's left");
  const payable = payableInvoices(all).filter((i) => i.kind === "cancellation-charge");
  assert.deepEqual(payable.map((i) => i.owedPence), [12_345], "the pay page offers it");
  const project = (await loadProject(DEMO3))!;
  assert.deepEqual(domain.customerNextAction(project), { label: domain.CANCELLATION_CHARGE_PAY_LABEL, href: `/p/${DEMO3}/pay` });
  assert.match(cancelledCopy(project)!.body, new RegExp(`${esc(money(12_345))} is left to pay`));
  const headline = payHeadline({ first: "Sam", cancelled: true, payableCount: 1, paidSomething: true, cancellation: project.cancellation!, workedEarly: true, settlement: domain.cancellationSettlement(project) });
  assert.match(headline.note ?? "", new RegExp(`${esc(money(12_345))} is left to pay, on the invoice below`));
  const issues = await issuesRepo.listForProject(DEMO3, { openOnly: true });
  assert.ok(issues.some((i) => new RegExp(`^Collect ${esc(money(12_345))}`).test(i.title)), "a task to collect it");
  assert.ok(!issues.some((i) => /^Refund £/.test(i.title)), "and none to refund");
  const email = (await messagesRepo.listForProject(DEMO3)).find((m) => m.event === "cancellation-confirmed" && /the charge for the work done/.test(m.subject ?? ""))!;
  assert.match(email.bodyText, new RegExp(`Left to pay: ${esc(money(12_345))}`));

  // Paying it (a bank transfer the office saw) settles it.
  const { recordManualPayment } = await import("../lib/money-server.ts");
  const paidIt = await recordManualPayment(DEMO3, { invoiceId: charge.id, amountPence: 12_345, method: "bank-transfer", receivedOn: londonToday(), reference: charge.number, requestId: crypto.randomUUID() }, DEMO_STAFF.admin);
  assert.ok(paidIt.ok, JSON.stringify(paidIt));
  const done = (await loadProject(DEMO3))!;
  assert.equal(domain.cancellationSettlement(done)!.owedPence, 0);
  assert.equal(domain.customerNextAction(done), null);
  assert.equal(domain.outstandingPence(await invoicesRepo.listForProject(DEMO3)), 0);
  assert.equal((await paymentsRepo.listForProject(DEMO3)).filter((p) => p.invoiceId === charge.id).length, 1);
});

test("no charge without the evidenced early-start request, after the period, above the contract, or invoiced any other way", async () => {
  await cancelledAfterEarlyWork({ evidenced: false });
  const none = await recordCancellationCharge(DEMO3, { amountPence: 10_000, basis: BASIS, requestId: `demo-${crypto.randomUUID()}` }, DEMO_STAFF.admin);
  assert.ok(!none.ok && /no evidenced request/.test(none.error), JSON.stringify(none));
  assert.equal((await invoicesRepo.listForProject(DEMO3)).filter((i) => i.kind === "cancellation-charge").length, 0);
  const direct = await issueInvoice(DEMO3, { kind: "cancellation-charge" }, DEMO_STAFF.admin);
  assert.ok(!direct.ok && /Record the charge/.test(direct.error), "never issued without a recorded charge");
  const release = await issueInvoice(DEMO3, { kind: "credit-note", amountPence: 100, reason: "DEMO", creditsInvoiceId: (await invoicesRepo.listForProject(DEMO3)).find((i) => i.kind === "deposit")!.id, releasePaid: true }, DEMO_STAFF.admin);
  assert.ok(!release.ok, "paid money is released only with a recorded charge");

  const ok = await cancelledAfterEarlyWork();
  const contract = ok.proposal.contractTotalPence!;
  const over = await recordCancellationCharge(DEMO3, { amountPence: contract + 1, basis: BASIS, requestId: `demo-${crypto.randomUUID()}` }, DEMO_STAFF.admin);
  assert.ok(!over.ok && /more than the contract total/.test(over.error));
  const short = await recordCancellationCharge(DEMO3, { amountPence: 10_000, basis: "a third", requestId: `demo-${crypto.randomUUID()}` }, DEMO_STAFF.admin);
  assert.ok(!short.ok && /how you worked it out/.test(short.error));

  // After the period: the contract's own terms, not a charge.
  await resetDemoData({ now: new Date().toISOString() });
  const p = (await loadProject(DEMO3))!;
  const today = londonToday();
  const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  p.proposal.goodsReceivedOn = addDays(today, -20);
  p.proposal.cancellationEndsOn = addDays(today, -6);
  p.proposal.earlyStart = { requested: true, wordingVersion: domain.EARLY_START_WORDING_VERSION, evidencedAt: p.proposal.acceptedAt };
  p.install = { ...p.install, status: "in-progress", days: [{ n: 1, date: addDays(today, -2), status: "done", startedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }] };
  assert.ok(await saveProject(p));
  const late = await recordCancellation(DEMO3, { receivedAt: hourAgo(), channel: "email", evidenceRef: "DEMO email" }, DEMO_STAFF.admin);
  assert.ok(late.ok && late.project.cancellation?.withinPeriod === false);
  const after = await recordCancellationCharge(DEMO3, { amountPence: 10_000, basis: BASIS, requestId: `demo-${crypto.randomUUID()}` }, DEMO_STAFF.admin);
  assert.ok(!after.ok && /after the cancellation period ended/.test(after.error));
});

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
