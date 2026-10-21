import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// A customer cancels their contract: one step records it and does what follows. Real modules, in-memory backend, DEMO data.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
registerAppResolver();
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { DEMO_STAFF } = await import("../lib/auth/demo-staff.ts");
const { recordCancellation } = await import("../lib/cancellation-server.ts");
const { loadProject } = await import("../lib/project-service.ts");
const { payableInvoices } = await import("../lib/money-server.ts");
const invoicesRepo = await import("../lib/repo/invoices.ts");
const issuesRepo = await import("../lib/repo/issues.ts");
const messagesRepo = await import("../lib/repo/messages.ts");

test("recording a cancellation closes the project, voids what's unpaid, raises the refund task and acknowledges it", async () => {
  const summary = await resetDemoData({ now: new Date().toISOString() });
  let projectId: string | undefined;
  for (const p of summary.projects) {
    const project = await loadProject(p.id);
    if (!projectId && project?.proposal.status === "accepted" && !project.closure.closed) projectId = p.id;
  }
  assert.ok(projectId, "a DEMO home with a live contract");
  const before = (await loadProject(projectId!))!;
  // An unpaid invoice waiting, as if a balance had gone out.
  const unpaid = await invoicesRepo.insertNumbered({
    id: crypto.randomUUID(),
    projectId: projectId!,
    kind: "survey-fee",
    status: "issued",
    lines: [{ label: "DEMO line", qtyLabel: "1", unitPence: 5_000, netPence: 5_000, taxCode: "outside-scope", taxPence: 0, totalPence: 5_000 }] as never,
    netPence: 5_000,
    taxPence: 0,
    totalPence: 5_000,
    paidPence: 0,
    issuedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  } as never);
  assert.ok(payableInvoices(await invoicesRepo.listForProject(projectId!)).some((i) => i.id === unpaid.id));

  const receivedAt = new Date(Date.now() - 3600_000).toISOString();
  const bad = await recordCancellation(projectId!, { receivedAt, channel: "email", evidenceRef: "x" }, DEMO_STAFF.admin);
  assert.equal(bad.ok, false, "where it's on file is required");

  const r = await recordCancellation(projectId!, { receivedAt, channel: "email", evidenceRef: "DEMO email: 'please cancel'" }, DEMO_STAFF.admin);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  const p = r.project;
  assert.equal(p.closure.reason, "cancelled");
  assert.equal(p.cancellation?.channel, "email");
  assert.match(p.cancellation!.refundDueBy, /^\d{4}-\d{2}-\d{2}$/);

  // No more money is asked for.
  assert.ok(r.voided.includes(unpaid.number));
  assert.equal((await invoicesRepo.get(unpaid.id))!.status, "void");

  // The refund is a task with an owner and a deadline when anything was paid.
  const issues = await issuesRepo.listForProject(projectId!);
  if (before.money.paidPence > 0) {
    const refund = issues.find((i) => /^Refund £/.test(i.title));
    assert.ok(refund, "the refund task");
    assert.equal(refund!.dueOn, p.cancellation!.refundDueBy);
    assert.equal(refund!.ownerRole, "admin");
    assert.equal(refund!.customerVisible, false);
  }

  // The customer's acknowledgement and the team's alert.
  const messages = await messagesRepo.listForProject(projectId!);
  const ack = messages.find((m) => m.event === "cancellation-confirmed" && m.channel === "email");
  assert.ok(ack, "the acknowledgement was recorded");
  assert.match(ack!.bodyText, /We received your cancellation on/);
  assert.ok(messages.some((m) => m.event === "team-alert" && /Cancelled:/.test(m.subject ?? m.bodyText)));

  // Recording it twice is refused: the project is closed.
  assert.equal((await recordCancellation(projectId!, { receivedAt, channel: "email", evidenceRef: "DEMO again" }, DEMO_STAFF.admin)).ok, false);
});

const { demoId } = await import("../lib/demo-seed/ids.ts");
const { saveProject } = await import("../lib/project-service.ts");
const { creditedInFull, issueInvoice, loadMoney, recordRefund, CANCELLED_NOTHING_TO_BILL } = await import("../lib/money-server.ts");
const { loadHub } = await import("../lib/portal-server.ts");
const DEMO3 = demoId("demo3:project");
const DEMO3_CUSTOMER = demoId("demo3:customer");

test("after a cancellation and its refund nothing more is billed: no fresh deposit, no invoice, the refunded one reads as refunded", async () => {
  await resetDemoData({ now: new Date().toISOString() });
  const deposit = (await invoicesRepo.listForProject(DEMO3)).find((i) => i.kind === "deposit" && i.paidPence > 0)!;
  assert.ok(deposit, "DEMO 3 paid its deposit");
  const r = await recordCancellation(DEMO3, { receivedAt: new Date(Date.now() - 3600_000).toISOString(), channel: "phone", evidenceRef: "DEMO call note" }, DEMO_STAFF.admin);
  assert.ok(r.ok, JSON.stringify(r));
  const refund = await recordRefund(
    DEMO3,
    { invoiceId: deposit.id, amountPence: deposit.paidPence, method: "bank-transfer", refundedOn: (await import("../lib/project-service.ts")).londonToday(), reason: "DEMO cancelled", requestId: crypto.randomUUID() },
    DEMO_STAFF.admin,
  );
  assert.ok(refund.ok, JSON.stringify(refund));
  assert.ok(refund.value.creditNote, "the refund's credit note");
  const all = await invoicesRepo.listForProject(DEMO3);
  const refunded = all.find((i) => i.id === deposit.id)!;
  assert.equal(refunded.paidPence, 0, "paid, then refunded");
  assert.equal(creditedInFull(refunded, all), false, "a refunded deposit was a real deposit: it never makes way for a fresh one");

  // The money page offers nothing to bill, and issuing is refused whatever the kind.
  const view = (await loadMoney(DEMO3))!;
  for (const plan of Object.values(view.plans)) {
    assert.equal(plan.available, false, plan.kind);
    assert.equal(plan.reason, CANCELLED_NOTHING_TO_BILL);
  }
  const emailsBefore = (await messagesRepo.listForProject(DEMO3)).filter((m) => m.event === "invoice-issued").length;
  for (const kind of ["deposit", "balance", "survey-fee", "change-fee", "variation"] as const) {
    const issued = await issueInvoice(DEMO3, { kind }, DEMO_STAFF.admin);
    assert.ok(!issued.ok && issued.error === CANCELLED_NOTHING_TO_BILL, `${kind}: ${JSON.stringify(issued)}`);
  }
  assert.equal((await invoicesRepo.listForProject(DEMO3)).length, all.length, "no invoice was made");
  assert.equal((await messagesRepo.listForProject(DEMO3)).filter((m) => m.event === "invoice-issued").length, emailsBefore, "no bill was emailed");
  // The family's page: the refunded deposit isn't a bill "due" on its old date, and nothing is to pay.
  const hub = (await loadHub(DEMO3, { kind: "customer", customerId: DEMO3_CUSTOMER }))!;
  const shown = hub.invoices.find((i) => i.id === deposit.id)!;
  assert.equal(shown.settled, "refunded");
  assert.equal(hub.money.outstandingPence, 0);

  // Money going back still works: a credit note can be issued.
  const credit = await issueInvoice(DEMO3, { kind: "credit-note", amountPence: 100, reason: "DEMO goodwill" }, DEMO_STAFF.admin);
  assert.ok(credit.ok, JSON.stringify(credit));

  // A deposit raised at the wrong figure and credited (a correction), with nothing paid, still gives way.
  const wrong = { ...deposit, id: "dep-wrong", paidPence: 0, status: "issued" as const };
  const fix = { ...deposit, id: "cn-fix", kind: "credit-note" as const, totalPence: -deposit.totalPence, creditsInvoiceId: "dep-wrong", creditPurpose: "correction" as const };
  assert.equal(creditedInFull(wrong, [wrong, fix]), true);
});

test("a cancellation that arrives after the period: an acknowledgement only, no refund or collection promised, and a review task", async () => {
  await resetDemoData({ now: new Date().toISOString() });
  const { londonToday } = await import("../lib/project-service.ts");
  const today = londonToday();
  const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  // DEMO 3's kit arrived long enough ago that the period has ended.
  const p = (await loadProject(DEMO3))!;
  p.proposal.goodsReceivedOn = addDays(today, -20);
  p.proposal.cancellationEndsOn = addDays(today, -6);
  assert.ok(await saveProject(p));
  const paid = p.money.paidPence;
  assert.ok(paid > 0, "they've paid a deposit");

  const r = await recordCancellation(DEMO3, { receivedAt: new Date(Date.now() - 3600_000).toISOString(), channel: "email", evidenceRef: "DEMO email: 'cancel please'" }, DEMO_STAFF.admin);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.project.cancellation?.withinPeriod, false);
  assert.equal(r.project.closure.reason, "cancelled");
  const titles = r.tasks.map((t) => t.title);
  assert.deepEqual(titles, ["Late cancellation: take advice, then write to the customer"], "no 'Refund £X by', no collection");
  assert.match(r.tasks[0]!.detail ?? "", /Nothing has been promised/);

  const messages = await messagesRepo.listForProject(DEMO3);
  const ack = messages.find((m) => m.event === "cancellation-confirmed" && m.channel === "email")!;
  assert.ok(ack, "they're told it reached us");
  assert.match(ack.bodyText, /after your cancellation period had ended/);
  assert.match(ack.bodyText, /We'll be in touch in writing/);
  assert.doesNotMatch(ack.bodyText, /We'll refund|We'll collect|is cancelled\./, "nothing promised before anyone has checked");
  const alert = messages.find((m) => m.event === "team-alert" && /Cancelled:/.test(m.subject ?? m.bodyText))!;
  assert.match(alert.bodyText, /no refund or collection was promised/);
  assert.doesNotMatch(alert.bodyText, /Refund £/);
  // Their page says the same.
  const line = r.project.events.find((e) => e.type === "cancellation-received")!;
  assert.doesNotMatch(line.label, /refund/i);
});

test("an invoice part-paid when the contract is cancelled: the unpaid part is credited, so nothing reads as owed anywhere", async () => {
  await resetDemoData({ now: new Date().toISOString() });
  const { owedInvoices, isInvoiceOverdue, invoiceOutstanding } = await import("@aircon/domain");
  const deposit = (await invoicesRepo.listForProject(DEMO3)).find((i) => i.kind === "deposit" && i.paidPence > 0)!;
  // The family paid 56p short: the deposit is part-paid at the moment they cancel.
  const paymentsRepo = await import("../lib/repo/payments.ts");
  const pay = (await paymentsRepo.listForInvoice(deposit.id)).find((x) => x.amountPence > 0)!;
  await paymentsRepo.update({ ...pay, amountPence: pay.amountPence - 56 });
  const short = { ...deposit, paidPence: deposit.paidPence - 56, status: "part-paid" as const };
  await invoicesRepo.update(short);
  assert.equal(invoiceOutstanding(short, await invoicesRepo.listForProject(DEMO3)), 56);
  const r = await recordCancellation(DEMO3, { receivedAt: new Date(Date.now() - 3600_000).toISOString(), channel: "phone", evidenceRef: "DEMO call note" }, DEMO_STAFF.admin);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.voided, [], "it was part-paid, so it isn't voided: what was paid stays on it to refund");
  const all = await invoicesRepo.listForProject(DEMO3);
  const cn = all.find((i) => i.kind === "credit-note" && i.creditsInvoiceId === deposit.id)!;
  assert.ok(cn, "a credit note for the unpaid part");
  assert.equal(cn.totalPence, -56);
  assert.equal(invoiceOutstanding(all.find((i) => i.id === deposit.id)!, all), 0);
  assert.deepEqual(owedInvoices(all), [], "the console's owed-to-us drops it");
  assert.equal(isInvoiceOverdue(all.find((i) => i.id === deposit.id)!, all, "2099-01-01"), false);
  const hub = (await loadHub(DEMO3, { kind: "customer", customerId: DEMO3_CUSTOMER }))!;
  assert.equal(hub.money.outstandingPence, 0, "their page has nothing to pay");
  const alert = (await messagesRepo.listForProject(DEMO3)).find((m) => m.event === "team-alert" && /Cancelled:/.test(m.subject ?? ""))!;
  assert.match(alert.bodyText, /Unpaid part credited/);
  // Then the refund of what they did pay: its own credit note, and nothing owed.
  const refund = await recordRefund(
    DEMO3,
    { invoiceId: deposit.id, amountPence: short.paidPence, method: "bank-transfer", refundedOn: (await import("../lib/project-service.ts")).londonToday(), reason: "DEMO cancelled", requestId: crypto.randomUUID() },
    DEMO_STAFF.admin,
  );
  assert.ok(refund.ok, JSON.stringify(refund));
  const after = await invoicesRepo.listForProject(DEMO3);
  assert.equal(invoiceOutstanding(after.find((i) => i.id === deposit.id)!, after), 0);
  // One credit note for the unpaid part, one with the refund.
  const credits = after.filter((i) => i.kind === "credit-note" && i.creditsInvoiceId === deposit.id).length;
  assert.equal(credits, 2);
});
