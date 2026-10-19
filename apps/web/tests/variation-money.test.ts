import { test } from "node:test";
import assert from "node:assert/strict";
import { createIssue } from "@aircon/domain";
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
        variation: { description: title, priceDeltaNetPence: net, taxRatePct: 0 },
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
