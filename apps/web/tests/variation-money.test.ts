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

  assert.equal((await decideVariation(demo3.id, actor, yes.id, "accept")).ok, true);
  assert.equal((await decideVariation(demo3.id, actor, no.id, "decline")).ok, true);
  assert.equal((await decideVariation(demo3.id, actor, yes.id, "decline")).ok, false, "decided once");

  const accepted = (await issuesRepo.get(yes.id))!;
  assert.equal(accepted.variation?.status, "accepted");
  assert.equal(accepted.status, "in-progress", "an accepted variation is work to do");
  assert.equal((await issuesRepo.get(no.id))!.status, "resolved", "a declined one is settled");

  const after = (await loadMoney(demo3.id))!;
  assert.equal(after.plans.balance.totalPence - balanceBefore, accepted.variation!.totalDeltaPence, "the balance grows by exactly the accepted variation");
  assert.ok(after.plans.balance.lines.some((l) => /Accepted variations/.test(l.label)));
  assert.deepEqual(after.plans.variation.variations?.map((v) => v.id), [yes.id], "or it can be billed on its own");
});
