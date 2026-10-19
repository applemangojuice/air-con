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
