import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, mergeSettings } from "@aircon/domain";
import { money } from "../lib/format.ts";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * The proposal journey end to end on the in-memory local backend, through
 * the real repositories, reducer, outbox (demo mode: stored, not sent) and
 * documents: revise → save → issue → view → accept, plus changes and
 * decline. DEMO data only (the demo seed).
 */

process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
delete process.env.RESEND_API_KEY;
registerAppResolver();

const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { demoId } = await import("../lib/demo-seed/ids.ts");
const { DEMO_STAFF } = await import("../lib/auth/demo-staff.ts");
const settingsRepo = await import("../lib/repo/settings.ts");
const proposalsRepo = await import("../lib/repo/proposals.ts");
const messagesRepo = await import("../lib/repo/messages.ts");
const { loadProject } = await import("../lib/project-service.ts");
const { listDocuments } = await import("../lib/documents-server.ts");
const server = await import("../lib/proposal-server.ts");

type Patch = import("../lib/proposal-server.ts").DraftPatch;

const ADMIN = DEMO_STAFF.admin;
const DEMO2 = demoId("demo2:project");
const DEMO2_CUSTOMER = demoId("demo2:customer");

/** Settings with the Schedule 2 details filled (DEMO), as an admin would before the first proposal. */
async function readySettings() {
  await settingsRepo.setValue(
    settingsRepo.PILOT_SETTINGS_KEY,
    mergeSettings({
      ...DEFAULT_SETTINGS,
      company: { ...DEFAULT_SETTINGS.company, geographicAddress: "DEMO: 1 Demo Street, London SW16 9ZZ", phone: "020 7946 0123", complaintsProcess: "DEMO: call or email us." },
      warranty: { workmanshipYears: 0, manufacturerSummary: "DEMO: the manufacturer's standard warranty." },
    }),
    "test",
  );
}

async function fresh() {
  await resetDemoData({ now: new Date().toISOString() });
  await readySettings();
}

function patchFrom(record: Awaited<ReturnType<typeof proposalsRepo.get>>, over: Partial<Patch> = {}): Patch {
  const r = record!;
  return {
    revision: r.draftRevision ?? 0,
    contractType: r.contractType ?? "supply-and-install",
    validUntil: r.validUntil,
    inclusions: r.inclusions,
    exclusions: r.exclusions,
    assumptions: r.assumptions,
    options: r.options.map((o) => ({
      designVariantId: o.designVariantId,
      label: o.label,
      summary: o.summary,
      highlights: o.highlights,
      roomCards: o.roomCards.map((c) => ({ roomId: c.roomId, unitName: c.unitName, why: c.why, highlights: c.highlights, ...(c.pipeNote ? { pipeNote: c.pipeNote } : {}) })),
      installDays: o.installDays,
      labour: o.labour,
      pricingInputs: { basis: "cost-plus", targetMarginPct: 35 },
    })),
    ...over,
  };
}

test("revise, save, issue: the new version supersedes the old, the email carries prices, a document is frozen", async () => {
  await fresh();
  const before = await loadProject(DEMO2);
  assert.equal(before?.proposal.status, "issued");
  const v1 = (await proposalsRepo.listForProject(DEMO2))[0]!;

  const revised = await server.reviseFrom(DEMO2, v1.id, ADMIN);
  assert.equal(revised.ok, true);
  const draftId = (revised as { proposalId: string }).proposalId;
  const again = await server.reviseFrom(DEMO2, v1.id, ADMIN);
  assert.equal((again as { proposalId: string }).proposalId, draftId, "one draft at a time");

  const draft = await proposalsRepo.get(draftId);
  assert.equal(draft?.status, "draft");
  assert.equal(draft?.version, 2);

  // A stale revision is refused, not merged.
  const stale = await server.saveDraft(DEMO2, draftId, patchFrom(draft, { revision: 7 }), ADMIN);
  assert.equal(stale.ok, false);

  // An incomplete manual price still saves the words; the price waits.
  const partial = patchFrom(draft, { increaseReason: "Your survey found a longer pipe run (DEMO)." });
  partial.options[0]!.pricingInputs = { basis: "manual" };
  partial.options[0]!.summary = "Edited summary (DEMO)";
  const saved = await server.saveDraft(DEMO2, draftId, partial, ADMIN);
  assert.equal(saved.ok, true);
  const s1 = saved as Extract<typeof saved, { ok: true }>;
  assert.match(s1.pricingErrors[partial.options[0]!.designVariantId]!, /manual price/);
  assert.equal(s1.proposal.options[0]!.summary, "Edited summary (DEMO)");
  assert.equal(s1.proposal.options[0]!.pricing.totalPence, 0);
  const notYet = await server.issueDraft(DEMO2, draftId, ADMIN);
  assert.equal(notYet.ok, false);
  assert.match((notYet as { errors?: string[] }).errors!.join(" "), /isn't priced yet/);

  // Priced properly, with a pilot discount.
  const priced = patchFrom(await proposalsRepo.get(draftId), { increaseReason: "Your survey found a longer pipe run (DEMO)." });
  priced.options = priced.options.map((o) => ({ ...o, pricingInputs: { basis: "cost-plus", targetMarginPct: 40, discountCode: "PILOT15" } }));
  const s2 = await server.saveDraft(DEMO2, draftId, priced, ADMIN);
  assert.equal(s2.ok, true);
  const record = (s2 as Extract<typeof s2, { ok: true }>).proposal;
  for (const o of record.options) {
    assert.ok(o.pricing.totalPence > 0);
    assert.equal(o.priceLines.reduce((a, l) => a + l.amountPence, 0), o.pricing.totalPence);
    assert.equal(o.pricing.discount?.code, "PILOT15");
  }

  const issued = await server.issueDraft(DEMO2, draftId, ADMIN);
  assert.deepEqual(issued, { ok: true, version: 2 });
  const project = await loadProject(DEMO2);
  assert.equal(project?.proposal.status, "issued");
  assert.equal(project?.proposal.proposalId, draftId);
  assert.equal(project?.proposal.version, 2);
  // Recorded by the outbox once the issue email went (stored as demo, which counts outside a live deployment).
  assert.ok(project?.proposal.preContractInfoSentAt, "the delivered issue email records the pre-contract information");
  assert.ok(project?.events.some((e) => e.type === "pre-contract-info-sent" && /demo mode/.test(e.label) && e.internal));
  assert.equal((await proposalsRepo.get(draftId))?.status, "issued");
  const old = await proposalsRepo.get(v1.id);
  assert.equal(old?.status, "superseded");
  assert.equal(old?.supersededBy, draftId);

  const messages = await messagesRepo.listForProject(DEMO2);
  const email = messages.find((m) => m.event === "proposal-issued" && m.channel === "email" && m.subject === "Your updated proposal is ready (version 2)");
  assert.ok(email, "the issue email was recorded");
  const total = record.options[0]!.pricing.totalPence;
  assert.ok(email!.bodyText.includes(money(total)), "the issue email carries the option's price");

  const docs = await listDocuments(DEMO2, { kind: "proposal" });
  const doc = docs[0]!;
  assert.equal(doc.version, 2);
  const snapshot = doc.snapshot as { proposal: { options: { costLines: unknown[]; pricing: { costPence: number } }[]; internalNotes?: string } };
  assert.deepEqual(snapshot.proposal.options[0]!.costLines, []);
  assert.equal(snapshot.proposal.options[0]!.pricing.costPence, 0);

  // Issued versions don't change.
  const frozen = await server.saveDraft(DEMO2, draftId, patchFrom(await proposalsRepo.get(draftId)), ADMIN);
  assert.equal(frozen.ok, false);
});

test("the customer views and accepts: a frozen record with the hash they saw, a contract, a durable confirmation", async () => {
  await fresh();
  const view = await server.loadCustomerProposal(DEMO2);
  assert.ok(view);
  assert.equal(view!.state, "open");
  assert.equal(view!.proposal.options[0]!.costLines.length, 0, "customer-safe");
  const proposalId = view!.proposal.id;
  const option = view!.proposal.options[0]!;
  const actor = { customerId: DEMO2_CUSTOMER };

  assert.deepEqual(await server.recordView(proposalId, actor), { ok: true });
  assert.ok((await loadProject(DEMO2))?.proposal.viewedAt);

  const form = {
    optionId: option.id,
    name: "Jordan Okafor",
    earlyStartRequested: true,
    acknowledgedCancellationInfo: true,
    acknowledgedLossOfRight: false,
    documentHash: view!.documentHash,
  };
  const changed = await server.acceptProposal(proposalId, { ...form, documentHash: "0".repeat(64) }, actor, {});
  assert.equal(changed.ok, false);
  assert.match((changed as { error: string }).error, /updated since you opened it/);
  const oneName = await server.acceptProposal(proposalId, { ...form, name: "Jordan" }, actor, {});
  assert.equal(oneName.ok, false);
  assert.equal((oneName as { status: number }).status, 422);
  assert.equal((await loadProject(DEMO2))?.proposal.status, "issued", "nothing written on a refusal");

  const accepted = await server.acceptProposal(proposalId, form, actor, { ip: "203.0.113.7", userAgent: "DEMO browser" });
  assert.equal(accepted.ok, true);
  const summary = (accepted as Extract<typeof accepted, { ok: true }>).summary;
  assert.equal(summary.optionLabel, option.label);
  assert.equal(summary.totalPence, option.pricing.totalPence);
  assert.equal(summary.earlyStartRequested, true);
  assert.match(summary.earlyStartWording ?? "", /Please start my installation/);
  assert.match(summary.cancellation, /days after the day it's delivered/);
  assert.ok(summary.contractDocumentId);

  const project = await loadProject(DEMO2);
  assert.equal(project?.proposal.status, "accepted");
  assert.equal(project?.proposal.contractTotalPence, option.pricing.totalPence);
  assert.equal(project?.proposal.earlyStart?.requested, true);
  assert.ok(project?.proposal.confirmationSentAt, "the confirmation email (demo mode) recorded the durable copy");

  const record = await proposalsRepo.get(proposalId);
  assert.equal(record?.status, "accepted");
  assert.equal(record?.acceptance?.documentHash, view!.documentHash);
  assert.equal(record?.acceptance?.ip, "203.0.113.7");
  assert.equal(record?.acceptance?.name, "Jordan Okafor");
  await assert.rejects(() => proposalsRepo.update({ ...record!, options: [] }), /accepted/, "the database freezes it");

  const contract = (await listDocuments(DEMO2, { kind: "contract" }))[0]!;
  const snap = contract.snapshot as { acceptance: { documentHash: string }; cancellationForm: string[]; option: { costLines: unknown[] } };
  assert.equal(snap.acceptance.documentHash, view!.documentHash);
  assert.ok(snap.cancellationForm.length > 3);
  assert.deepEqual(snap.option.costLines, []);
  const confirmation = (await messagesRepo.listForProject(DEMO2)).find((m) => m.event === "proposal-accepted" && m.channel === "email" && m.bodyText.includes("Jordan Okafor"));
  assert.ok(confirmation, "the confirmation email carries the acceptance record");

  // A retry after a lost response gets the same answer, not an error.
  const retry = await server.acceptProposal(proposalId, form, actor, {});
  assert.equal(retry.ok, true);
  assert.equal((retry as Extract<typeof retry, { ok: true }>).summary.alreadyAccepted, true);

  // And nothing can revise an accepted contract.
  const revise = await server.reviseFrom(DEMO2, proposalId, ADMIN);
  assert.equal(revise.ok, false);
  const after = await server.loadCustomerProposal(DEMO2);
  assert.equal(after?.state, "accepted");
});

test("changes requested, then declined: the reducer moves, the team hears", async () => {
  await fresh();
  const view = (await server.loadCustomerProposal(DEMO2))!;
  const actor = { customerId: DEMO2_CUSTOMER };
  assert.deepEqual(await server.requestChanges(view.proposal.id, "Could the bedroom unit go on the other wall? (DEMO)", actor), { ok: true });
  assert.equal((await loadProject(DEMO2))?.proposal.status, "changes-requested");
  assert.deepEqual(await server.requestChanges(view.proposal.id, "Could the bedroom unit go on the other wall? (DEMO)", actor), { ok: true }, "a retry is harmless");
  assert.deepEqual(await server.requestChanges(view.proposal.id, "And a quieter outdoor unit (DEMO)", actor), { ok: true });
  assert.match((await proposalsRepo.get(view.proposal.id))?.changeRequest ?? "", /quieter outdoor unit/);
  assert.equal((await server.loadCustomerProposal(DEMO2))?.state, "changes-requested");

  assert.deepEqual(await server.declineProposal(view.proposal.id, "Going with a neighbour's installer (DEMO)", actor), { ok: true });
  assert.equal((await loadProject(DEMO2))?.proposal.status, "declined");
  assert.equal((await proposalsRepo.get(view.proposal.id))?.status, "declined");
  assert.equal((await server.loadCustomerProposal(DEMO2))?.state, "declined");
  const alert = (await messagesRepo.listForProject(DEMO2)).find((m) => m.event === "team-alert" && m.bodyText.includes("Going with a neighbour"));
  assert.ok(alert, "the team alert was recorded");
});

test("the builder loads with blockers and the design; a draft starts from the approved design", async () => {
  await fresh();
  const data = await server.loadBuilder(DEMO2, ADMIN);
  assert.ok(data?.design, "approved design");
  assert.ok(data?.ctx);
  assert.equal(data?.current?.status, "issued");
  assert.ok(Object.keys(data!.media).length > 0, "signed photo URLs");
  const demo4 = demoId("demo4:project");
  const d4 = await server.loadBuilder(demo4, ADMIN);
  assert.equal(d4?.design, null, "design still in review: no approved design");
  const start = await server.startDraft(demo4, ADMIN);
  assert.equal(start.ok, false);
});
