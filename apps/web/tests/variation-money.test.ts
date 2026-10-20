import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, createIssue, mergeSettings, type StaffMember } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// F1 decides a variation on the portal; F5's balance invoice bills it. The real modules on the in-memory backend.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { decideVariation } = await import("../lib/portal-server.ts");
const { loadMoney } = await import("../lib/money-server.ts");
const { loadProject } = await import("../lib/project-service.ts");
const issuesRepo = await import("../lib/repo/issues.ts");
const messagesRepo = await import("../lib/repo/messages.ts");
const { listDocuments } = await import("../lib/documents-server.ts");
const { issueInvoice } = await import("../lib/money-server.ts");
const { sendVariation, variationTaxCode } = await import("../lib/variation-server.ts");
const settingsRepo = await import("../lib/repo/settings.ts");

const OFFICE: StaffMember = { id: "aa000000-0000-4000-8000-0000000000c1", email: "office@demo.dang.invalid", name: "DEMO Office", roles: ["admin"], external: false, active: true, qualifications: [] };

test("a variation the customer accepts on the portal is billed by the balance invoice; a declined one isn't", async () => {
  const summary = await resetDemoData({ now: new Date().toISOString() });
  const demo3 = summary.projects.find((p) => p.label.startsWith("DEMO 3"))!;
  const project = (await loadProject(demo3.id))!;
  const before = (await loadMoney(demo3.id))!;
  const balanceBefore = before.plans.balance.totalPence;

  const raise = async (title: string, net: number) =>
    issuesRepo.insert(
      createIssue({
        id: crypto.randomUUID(),
        projectId: demo3.id,
        number: await issuesRepo.nextNumber(demo3.id),
        kind: "variation",
        title,
        raisedBy: { kind: "staff", name: "DEMO Tech" },
        raisedAt: new Date().toISOString(),
        variation: { description: title, priceDeltaNetPence: net, taxCode: "outside-scope" },
      }),
    );
  const yes = await raise("DEMO: condensate pump in the loft", 18_000);
  const no = await raise("DEMO: extra 3 m of trunking", 6_000);
  const actor = { customerId: project.customer.customerId! };

  // A yes is an agreement to pay: one tap isn't enough.
  const tapOnly = await decideVariation(demo3.id, actor, yes.id, "accept");
  assert.equal(tapOnly.ok, false);
  assert.ok(!tapOnly.ok && /first name and surname/.test(tapOnly.error));
  const noPress = await decideVariation(demo3.id, actor, yes.id, "accept", { name: "Jordan Okafor" });
  assert.ok(!noPress.ok && /I agree to pay £180 more/.test(noPress.error), "the button's own words");
  assert.equal((await issuesRepo.get(yes.id))!.variation?.status, "proposed", "nothing recorded on a refusal");
  const accept = await decideVariation(demo3.id, actor, yes.id, "accept", { name: "  Jordan   Okafor ", agreed: true, ip: "203.0.113.9", userAgent: "DEMO browser" });
  assert.equal(accept.ok, true);
  // A no stays one tap.
  assert.equal((await decideVariation(demo3.id, actor, no.id, "decline")).ok, true);
  assert.equal((await decideVariation(demo3.id, actor, yes.id, "decline")).ok, false, "decided once");
  // The same answer again (a retry after a lost reply, or a page that hadn't caught up): saved, said so, nothing twice.
  const yesAgain = await decideVariation(demo3.id, actor, yes.id, "accept", { name: "Jordan Okafor", agreed: true });
  assert.ok(yesAgain.ok && /already said yes/.test(yesAgain.message ?? ""), JSON.stringify(yesAgain));
  const noAgain = await decideVariation(demo3.id, actor, no.id, "decline");
  assert.ok(noAgain.ok && /already said no/.test(noAgain.message ?? ""));
  assert.equal((await decideVariation(demo3.id, actor, no.id, "accept", { name: "Jordan Okafor", agreed: true })).ok, false, "a different answer is still refused");

  const accepted = (await issuesRepo.get(yes.id))!;
  assert.equal(accepted.variation?.status, "accepted");
  // The durable record of the agreement: typed name, the exact words, a fingerprint, where from.
  const a = accepted.variation!.acceptance!;
  assert.equal(a.name, "Jordan Okafor");
  assert.equal(accepted.variation!.decidedBy, "Jordan Okafor");
  assert.equal(a.wording, "I agree to pay £180 more");
  assert.match(a.contentHash, /^[0-9a-f]{64}$/);
  assert.deepEqual([a.priceDeltaNetPence, a.taxPence, a.totalDeltaPence, a.ip, a.userAgent], [18_000, 0, 18_000, "203.0.113.9", "DEMO browser"]);
  assert.equal((await issuesRepo.get(no.id))!.variation?.acceptance, undefined);
  // Its own customer-visible document, and the customer's emailed copy.
  const docs = await listDocuments(demo3.id, { kind: "variation", customerVisibleOnly: true });
  const doc = docs.find((d) => (d.snapshot as { issue?: { id?: string } }).issue?.id === yes.id);
  assert.ok(doc, "a variation document for the accepted change");
  assert.equal((doc!.snapshot as { issue: { variation: { acceptance?: { name: string } } } }).issue.variation.acceptance?.name, "Jordan Okafor");
  assert.ok(!docs.some((d) => (d.snapshot as { issue?: { id?: string } }).issue?.id === no.id), "none for a declined one");
  const copy = (await messagesRepo.listForProject(demo3.id)).find((m) => m.event === "variation-accepted" && m.channel === "email");
  assert.ok(copy, "the customer's copy was recorded");
  assert.match(copy!.bodyText, /I agree to pay £180 more/);
  assert.match(copy!.bodyText, /Jordan Okafor/);
  assert.equal(copy!.linkPath, `/d/${doc!.id}`);
  assert.equal(accepted.status, "in-progress", "an accepted variation is work to do");
  assert.equal((await issuesRepo.get(no.id))!.status, "resolved", "a declined one is settled");

  const after = (await loadMoney(demo3.id))!;
  assert.equal(after.plans.balance.totalPence - balanceBefore, accepted.variation!.totalDeltaPence, "the balance grows by exactly the accepted variation");
  assert.ok(after.plans.balance.lines.some((l) => /Accepted variations/.test(l.label)));
  assert.deepEqual(after.plans.variation.variations?.map((v) => v.id), [yes.id], "or it can be billed on its own");
});

test("a variation is priced and invoiced on the contract's tax code, never on the settings default", async () => {
  // The founders tick "VAT registered" and leave the default tax code at outside-scope.
  const registered = mergeSettings({ ...DEFAULT_SETTINGS, tax: { ...DEFAULT_SETTINGS.tax, vatRegistered: true, defaultTaxCode: "outside-scope" } });
  await settingsRepo.setValue(settingsRepo.PILOT_SETTINGS_KEY, registered, "test");
  const summary = await resetDemoData({ now: new Date().toISOString(), settings: registered });
  const demo3 = summary.projects.find((p) => p.label.startsWith("DEMO 3"))!;
  const demo1 = summary.projects.find((p) => p.label.startsWith("DEMO 1"))!;
  const project = (await loadProject(demo3.id))!;
  assert.equal(await variationTaxCode(demo3.id), "standard-20", "the contract was priced at the standard rate");
  assert.equal(await variationTaxCode(demo1.id), "standard-20", "no contract yet: settings as they must be charged, not outside-scope");

  // Proposed on site, checked and sent by the office, accepted by the customer.
  const draft = await issuesRepo.insert(
    createIssue({
      id: crypto.randomUUID(),
      projectId: demo3.id,
      number: await issuesRepo.nextNumber(demo3.id),
      kind: "variation",
      title: "DEMO: condensate pump",
      raisedBy: { kind: "staff", name: "DEMO Tech" },
      raisedAt: new Date().toISOString(),
      variation: { description: "DEMO: a pump", priceDeltaNetPence: 9_000, taxCode: await variationTaxCode(demo3.id), officeReview: true },
    }),
  );
  assert.equal(draft.variation?.taxCode, "standard-20");
  // Settings change after acceptance (VAT unticked by mistake): the contract's code still rules.
  await settingsRepo.setValue(settingsRepo.PILOT_SETTINGS_KEY, mergeSettings({ ...registered, tax: { ...registered.tax, vatRegistered: false } }), "test");
  const sent = await sendVariation(demo3.id, draft.id, { description: "A condensate pump in the loft (DEMO)", priceDeltaNetPence: 10_000 }, OFFICE);
  assert.ok(sent.ok, !sent.ok ? sent.error : "");
  assert.deepEqual([sent.value.variation?.priceDeltaNetPence, sent.value.variation?.taxPence, sent.value.variation?.totalDeltaPence, sent.value.variation?.taxCode], [10_000, 2_000, 12_000, "standard-20"]);
  const accepted = await decideVariation(demo3.id, { customerId: project.customer.customerId! }, draft.id, "accept", { name: "Jordan Okafor", agreed: true });
  assert.ok(accepted.ok, JSON.stringify(accepted));

  const plan = (await loadMoney(demo3.id))!.plans.variation.variations!.find((v) => v.id === draft.id)!;
  assert.deepEqual([plan.totalPence, plan.taxCode], [12_000, "standard-20"]);
  const invoice = await issueInvoice(demo3.id, { kind: "variation", issueId: draft.id, requestId: crypto.randomUUID() }, OFFICE);
  assert.ok(invoice.ok, !invoice.ok ? invoice.error : "");
  // The VAT the customer agreed to is the VAT on the invoice: not a sixth of it out of the margin.
  assert.deepEqual(
    invoice.value.lines.map((l) => [l.netPence, l.taxPence, l.totalPence, l.taxCode]),
    [[10_000, 2_000, 12_000, "standard-20"]],
  );
});
