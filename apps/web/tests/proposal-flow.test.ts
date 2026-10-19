import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, mergeSettings, performanceDueOn } from "@aircon/domain";
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

test("payment terms are frozen at issue: a later settings change never changes the page, the hash, the contract or the deposit", async () => {
  await fresh();
  const { loadMoney } = await import("../lib/money-server.ts");
  const v1 = (await proposalsRepo.listForProject(DEMO2))[0]!;
  const draftId = ((await server.reviseFrom(DEMO2, v1.id, ADMIN)) as { proposalId: string }).proposalId;
  const priced = patchFrom(await proposalsRepo.get(draftId), { increaseReason: "Your survey found a longer pipe run (DEMO)." });
  assert.equal((await server.saveDraft(DEMO2, draftId, priced, ADMIN)).ok, true);
  // Issued with no deposit (the shipped default).
  const issuedResult = await server.issueDraft(DEMO2, draftId, ADMIN);
  assert.equal(issuedResult.ok, true, JSON.stringify(issuedResult));
  const issued = (await proposalsRepo.get(draftId))!;
  assert.deepEqual(issued.terms, { depositPct: 0, depositTiming: "on-acceptance", balanceDueDays: 7, methods: ["bank-transfer", "card"], cancellationDays: 14, installWithinWeeks: 8 });
  // The full terms text is frozen with it, and emailed in full.
  assert.ok(issued.termsText && issued.termsText.length >= 10, "the terms text is on the record");
  assert.deepEqual(issued.termsText!.map((t) => t.id).slice(0, 3), ["who", "price", "survey"]);
  assert.ok(issued.termsText!.some((t) => t.id === "liability" && /limited to the price you paid us/.test(t.items.join(" "))));
  const before = (await server.loadCustomerProposal(DEMO2))!;
  assert.deepEqual(before.proposal.termsText, issued.termsText, "the customer sees the frozen text");
  const issueMail = (await messagesRepo.listForProject(DEMO2)).find((m) => m.event === "proposal-issued" && m.channel === "email" && /version 2/.test(m.subject ?? ""));
  assert.match(issueMail!.bodyText, /There's no deposit/);
  assert.match(issueMail!.bodyText, /We'll finish your installation within 8 weeks of the day you accept/, "Schedule 2 (j)");
  assert.match(issueMail!.bodyText, new RegExp(`Our terms \\(version ${issued.termsVersion}\\)`, "i"));
  assert.match(issueMail!.bodyText, /12\. Our responsibility to you/);

  // The founders turn deposits on after it went out.
  const live = mergeSettings(await settingsRepo.getValue(settingsRepo.PILOT_SETTINGS_KEY));
  await settingsRepo.setValue(settingsRepo.PILOT_SETTINGS_KEY, mergeSettings({ ...live, payments: { ...live.payments, depositPct: 25, balanceDueDays: 30 }, scheduling: { ...live.scheduling, installWithinWeeks: 20 } }), "test");

  const after = (await server.loadCustomerProposal(DEMO2))!;
  assert.equal(after.settings.payments.depositPct, 0, "the page still shows the terms it was issued on");
  assert.equal(after.settings.payments.balanceDueDays, 7);
  assert.equal(after.documentHash, before.documentHash, "same terms, same fingerprint");

  const option = after.proposal.options[0]!;
  const accepted = await server.acceptProposal(
    draftId,
    { optionId: option.id, name: "Jordan Okafor", earlyStartRequested: false, acknowledgedCancellationInfo: true, acknowledgedLossOfRight: false, documentHash: after.documentHash },
    { customerId: DEMO2_CUSTOMER },
    {},
  );
  assert.equal(accepted.ok, true);
  const contract = (await listDocuments(DEMO2, { kind: "contract" }))[0]!;
  const payments = (contract.snapshot as { payments: { depositPct: number; depositPence: number; balanceDueDays: number } }).payments;
  // The terms they accepted travel with the contract, fingerprinted on the acceptance.
  const { termsHash } = await import("../components/proposal/model.ts");
  const acceptedRecord = (await proposalsRepo.get(draftId))!;
  assert.equal(acceptedRecord.acceptance?.termsHash, await termsHash(issued));
  assert.match(acceptedRecord.acceptance!.termsHash!, /^[0-9a-f]{64}$/);
  const contractTerms = contract.snapshot as { termsText?: unknown; termsHash?: string };
  assert.deepEqual(contractTerms.termsText, issued.termsText);
  assert.equal(contractTerms.termsHash, acceptedRecord.acceptance?.termsHash);
  assert.deepEqual([payments.depositPct, payments.depositPence, payments.balanceDueDays], [0, 0, 7], "the contract states the terms offered");
  // Schedule 2 (j): finished within the weeks offered (8, not today's 20), from the day they accepted.
  const performance = (contract.snapshot as { performance?: { withinWeeks: number; byDate: string } }).performance;
  assert.equal(performance?.withinWeeks, 8);
  assert.equal(performance?.byDate, performanceDueOn(acceptedRecord.acceptance!.at, 8));
  // And the documents-by-email agreement goes into the acceptance in full.
  const consentCopy = acceptedRecord.acceptance?.documentsByEmailConsent;
  assert.equal(consentCopy?.at, acceptedRecord.acceptance?.documentsByEmailConsentAt);
  assert.match(consentCopy?.wordingVersion ?? "", /^docs-by-email\//);
  assert.match(consentCopy?.text ?? "", /proposal and contract documents by email/);
  const confirmation = (await messagesRepo.listForProject(DEMO2)).find((m) => m.event === "proposal-accepted" && m.channel === "email");
  assert.match(confirmation!.bodyText, /There's no deposit/);
  assert.match(confirmation!.bodyText, /within 8 weeks of the day you accept/);
  assert.match(confirmation!.bodyText, /within 7 days of the invoice/);
  assert.match(confirmation!.bodyText, /our terms are in full at the end of this email/);
  assert.match(confirmation!.bodyText, /14\. The legal bits/);

  // No deposit invoice can be raised on a contract that has none, whatever settings say now.
  const money = (await loadMoney(DEMO2))!;
  assert.equal(money.plans.deposit.available, false);
  assert.match(money.plans.deposit.reason ?? "", /no deposit/);

  // The other way round: a 25% contract keeps its deposit after settings drop to 0%,
  // and the contract document's schedule wins over everything.
  const { agreedTerms } = await import("../lib/money-server.ts");
  const zero = mergeSettings({ ...live, payments: { ...live.payments, depositPct: 0 } });
  assert.equal(agreedTerms(zero, { ...issued, terms: { ...issued.terms!, depositPct: 25 } }, undefined).payments.depositPct, 25);
  const doc = { ...contract, snapshot: { ...(contract.snapshot as object), payments: { ...payments, depositPct: 10, depositPence: 12_300, balanceDueDays: 14 } } };
  const fromDoc = agreedTerms(zero, issued, doc);
  assert.deepEqual([fromDoc.payments.depositPct, fromDoc.payments.balanceDueDays], [10, 14]);
});

test("issuing while a colleague's autosave lands: one set of prices issued, emailed and frozen, and nobody's 'Saved' is lost", async () => {
  // Microtask steps: on the in-memory backend each database call takes a few.
  const tick = async (n: number) => {
    for (let i = 0; i < n; i++) await Promise.resolve();
  };
  const priceOf = (r: { options: { pricing: { totalPence: number } }[] }) => r.options[0]!.pricing.totalPence;
  const branches = new Set<string>();
  // Negative: the colleague's save starts first and the issue that many ticks later.
  for (const delay of [-400, -100, -50, -25, -10, -5, 0, 5, 10, 25, 50, 100, 400]) {
    await fresh();
    const v1 = (await proposalsRepo.listForProject(DEMO2))[0]!;
    const draftId = ((await server.reviseFrom(DEMO2, v1.id, ADMIN)) as { proposalId: string }).proposalId;
    const s1 = await server.saveDraft(DEMO2, draftId, patchFrom(await proposalsRepo.get(draftId), { increaseReason: "DEMO" }), ADMIN);
    assert.ok(s1.ok);
    const seen = s1.proposal.draftRevision ?? 0;
    const issuerPrice = priceOf(s1.proposal);
    // Admin B, on the same draft in another browser, moves the margin from 35% to 50%.
    const bPatch = patchFrom(await proposalsRepo.get(draftId), { increaseReason: "DEMO" });
    bPatch.options = bPatch.options.map((o) => ({ ...o, pricingInputs: { basis: "cost-plus", targetMarginPct: 50 } }));
    const [issued, saved] = await Promise.all([
      tick(Math.max(0, -delay)).then(() => server.issueDraft(DEMO2, draftId, ADMIN, { revision: seen })),
      tick(Math.max(0, delay)).then(() => server.saveDraft(DEMO2, draftId, bPatch, ADMIN)),
    ]);
    assert.ok(issued.ok !== saved.ok, `delay ${delay}: exactly one wins (issue ${JSON.stringify(issued)}, save ${saved.ok ? "ok" : saved.error})`);
    const rec = (await proposalsRepo.get(draftId))!;
    if (issued.ok) {
      assert.match(saved.ok ? "" : saved.error, /issued|Someone else saved/, `delay ${delay}: the colleague is told`);
      branches.add("issue");
      assert.equal(rec.status, "issued");
      assert.equal(priceOf(rec), issuerPrice, `delay ${delay}: what the issuer saw is what's issued`);
      const email = (await messagesRepo.listForProject(DEMO2)).find((m) => m.event === "proposal-issued" && m.channel === "email" && m.idempotencyKey.includes(draftId));
      assert.ok(email, `delay ${delay}: the issue email`);
      assert.ok(email!.bodyText.includes(money(issuerPrice)), `delay ${delay}: the email quotes the issued price`);
      const doc = (await listDocuments(DEMO2, { kind: "proposal" }))[0]!;
      assert.equal((doc.snapshot as { proposal: { id: string; options: { pricing: { totalPence: number } }[] } }).proposal.options[0]!.pricing.totalPence, issuerPrice);
    } else {
      assert.match(issued.error, /Someone saved this draft|Someone else saved/, `delay ${delay}: the issuer is told`);
      branches.add("save");
      assert.equal(rec.status, "draft", `delay ${delay}: nothing issued`);
      assert.equal(priceOf(rec), priceOf((saved as Extract<typeof saved, { ok: true }>).proposal), `delay ${delay}: the colleague's save stands`);
      assert.ok(!(await messagesRepo.listForProject(DEMO2)).some((m) => m.event === "proposal-issued" && m.idempotencyKey.includes(draftId)), "no email");
    }
  }

  assert.deepEqual([...branches].sort(), ["issue", "save"], "both orders were exercised");

  // An issuer whose builder is behind (a colleague saved since) is refused before anything goes.
  await fresh();
  const v1 = (await proposalsRepo.listForProject(DEMO2))[0]!;
  const draftId = ((await server.reviseFrom(DEMO2, v1.id, ADMIN)) as { proposalId: string }).proposalId;
  const s = await server.saveDraft(DEMO2, draftId, patchFrom(await proposalsRepo.get(draftId), { increaseReason: "DEMO" }), ADMIN);
  assert.ok(s.ok);
  const behind = await server.issueDraft(DEMO2, draftId, ADMIN, { revision: (s.proposal.draftRevision ?? 0) - 1 });
  assert.ok(!behind.ok && /since you last loaded it/.test(behind.error));
  assert.equal((await proposalsRepo.get(draftId))!.status, "draft");
});
