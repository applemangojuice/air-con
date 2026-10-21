import { test } from "node:test";
import assert from "node:assert/strict";
import { blockersFor, generateQuote, type StaffMember } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";
import { quoteRow } from "./helpers/rows.ts";

// Round 9: a "planning permission or listed building consent needed" outcome holds install day 1
// on the real compliance and readiness modules (in-memory local backend).
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { createProjectForQuote, buildReadinessContext, loadProject, DEMO_SURVEY } = await import("../lib/project-service.ts");
const { reviewItem, loadChecklist } = await import("../lib/compliance-server.ts");
const { requireDb } = await import("../lib/supabase-server.ts");
const complianceRepo = await import("../lib/repo/compliance.ts");

/** DEMO people only. */
const TECH: StaffMember = {
  id: "5a5a5a5a-2222-4222-8222-000000000009",
  email: "tess@demo.dang.invalid",
  name: "DEMO Tess",
  roles: ["tech-lead"],
  external: false,
  active: true,
  qualifications: [],
  demo: true,
};

async function newProject(): Promise<string> {
  const quoteId = crypto.randomUUID();
  await requireDb()
    .from("quote_requests")
    .insert(quoteRow({ id: quoteId, customer_name: "DEMO Lee", email: `lee.${quoteId.slice(0, 8)}@example.test`, source: "web", survey: DEMO_SURVEY, quote: generateQuote(DEMO_SURVEY) }));
  const created = await createProjectForQuote(quoteId);
  assert.ok("id" in created, JSON.stringify(created));
  return created.id;
}

const consentBlocks = async (id: string) => {
  const project = (await loadProject(id))!;
  const ctx = await buildReadinessContext(project);
  return blockersFor(project, ctx, "ready-to-install").filter((b) => b.code === "compliance:planning-consent");
};

test("'consent needed' recorded on the checklist holds day 1 at once; 'PD checks passed' settles the consent item by itself", async () => {
  const id = await newProject();
  const pd = (await complianceRepo.getByKey(id, "planning-pd"))!;
  const consent = await complianceRepo.getByKey(id, "planning-consent");
  assert.ok(consent, "a new project's checklist has the planning consent item");

  const refused = await reviewItem(id, pd.id, { to: "approved", note: "Planning route needed: unit count over the limit (DEMO)" }, TECH);
  assert.ok(!refused.ok && /Choose the outcome/.test(refused.error), "the note alone doesn't say which way it went");

  const needed = await reviewItem(id, pd.id, { to: "approved", note: "Two outdoor units on a semi: planning application needed (DEMO)", planningOutcome: "consent-needed" }, TECH);
  assert.ok(needed.ok, JSON.stringify(needed));
  assert.equal((await complianceRepo.getByKey(id, "planning-consent"))?.status, "evidence-required", "brought in line straight after the review");
  const blocks = await consentBlocks(id);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0]!.message, /No drilling until the council has granted planning permission or listed building consent/);

  // The outcome changed (a different position passes PD): reopened, then recorded as passed.
  const back = await reviewItem(id, pd.id, { to: "under-review", note: "Unit moved to the rear (DEMO)" }, TECH);
  assert.ok(back.ok);
  const passed = await reviewItem(id, pd.id, { to: "approved", note: "PD checks passed for the rear position (DEMO)", planningOutcome: "pd" }, TECH);
  assert.ok(passed.ok, JSON.stringify(passed));
  const settled = await complianceRepo.getByKey(id, "planning-consent");
  assert.equal(settled?.status, "not-applicable");
  assert.match(settled?.note ?? "", /Not needed: DEMO Tess recorded "PD checks passed"/);
  assert.deepEqual(await consentBlocks(id), []);
});

test("a checklist from before the consent item: the day-1 gate still holds on the outcome, and the compliance page adds the item", async () => {
  const id = await newProject();
  const pd = (await complianceRepo.getByKey(id, "planning-pd"))!;
  await requireDb().from("compliance_items").delete().eq("project_id", id).eq("key", "planning-consent");
  assert.equal(await complianceRepo.getByKey(id, "planning-consent"), null);
  // Approved the old way (a free-text note) is reopened before day 1: the outcome must be chosen.
  await complianceRepo.update({ ...pd, status: "approved", note: "Planning route needed: Grade II listed (DEMO)", reviewedBy: "DEMO Tess", reviewedAt: new Date().toISOString() });
  const project = (await loadProject(id))!;
  const ctx = await buildReadinessContext(project);
  const codes = blockersFor(project, ctx, "ready-to-install").map((b) => b.code);
  // The stored row still says approved, but the gate reads it as open (the outcome isn't recorded), and that
  // one line covers the consent item too.
  assert.ok(codes.includes("compliance:planning-pd"), codes.join(", "));
  assert.ok(!codes.includes("compliance:planning-consent"), "one line, not two");
  // Recorded as "consent needed" (still the old checklist, no consent item stored): the gate holds on the consent.
  await complianceRepo.update({ ...(await complianceRepo.getByKey(id, "planning-pd"))!, planningOutcome: "consent-needed" });
  const after = blockersFor(project, await buildReadinessContext(project), "ready-to-install").map((b) => b.code);
  assert.ok(after.includes("compliance:planning-consent") && !after.includes("compliance:planning-pd"), after.join(", "));
  await complianceRepo.update({ ...(await complianceRepo.getByKey(id, "planning-pd"))!, planningOutcome: undefined });

  const items = await loadChecklist(project);
  assert.equal(items.find((i) => i.key === "planning-consent")?.status, "not-started", "added by itself before day 1");
  assert.equal(items.find((i) => i.key === "planning-pd")?.status, "under-review", "the old free-text approval is asked again");
});

test("a flat in a block: the Building Regulations route refuses a building notice, from the survey's own answer", async () => {
  const { emptyMeasuredSurvey } = await import("@aircon/domain");
  const surveysRepo = await import("../lib/repo/surveys.ts");
  const id = await newProject();
  const data = emptyMeasuredSurvey();
  data.house.type = "flat";
  data.house.block = { storeys: 8, crossing: "yes", freeholder: "DEMO Estates" };
  await surveysRepo.insert({ id: crypto.randomUUID(), projectId: id, version: 1, status: "submitted", data });
  const regs = (await complianceRepo.getByKey(id, "heat-pump-building-regs"))!;
  const note = "DEMO: application reference BSR-0001 (DEMO).";
  const notice = await reviewItem(id, regs.id, { to: "approved", note, buildingRegsRoute: "building-notice" }, TECH);
  assert.ok(!notice.ok && /higher-risk building/.test(notice.error), JSON.stringify(notice));
  const plans = await reviewItem(id, regs.id, { to: "approved", note, buildingRegsRoute: "full-plans" }, TECH);
  assert.ok(!plans.ok && /Building Safety Regulator's approval/.test(plans.error));
  const bsr = await reviewItem(id, regs.id, { to: "approved", note, buildingRegsRoute: "bsr" }, TECH);
  assert.ok(bsr.ok, JSON.stringify(bsr));
  assert.equal((await complianceRepo.getByKey(id, "heat-pump-building-regs"))?.buildingRegsRoute, "bsr");
});

test("the follow-up footer's stop link turns follow-ups off for that project, with one button and no sign-in", async () => {
  const { stopLink } = await import("../lib/follow-up-stop.ts");
  const { stopFollowUpsAction } = await import("../app/stop/actions.ts");
  const id = await newProject();
  const link = await stopLink("https://dang.example", id);
  assert.ok(link, "the dev secret signs it outside production");
  const sig = new URL(link!).searchParams.get("s")!;
  assert.match((await stopFollowUpsAction(id, "0".repeat(40), {}, new FormData())).error ?? "", /doesn't work/);
  assert.equal((await loadProject(id))!.aftercare.followUpsOptedOutAt, undefined);
  assert.deepEqual(await stopFollowUpsAction(id, sig, {}, new FormData()), { done: true });
  assert.ok((await loadProject(id))!.aftercare.followUpsOptedOutAt);
  assert.deepEqual(await stopFollowUpsAction(id, sig, {}, new FormData()), { done: true }, "a second tap reads the same");
});
