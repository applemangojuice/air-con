import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, mergeSettings, type StaffMember } from "@aircon/domain";
import { failingQuery, interceptTable } from "./helpers/db-intercept.ts";
import { registerAppResolver } from "./helpers/resolve-app.ts";

/**
 * Writes that must not race or run on guesses (hardening review, batch 8),
 * on the real modules and the in-memory backend with DEMO data: a settings
 * read that fails stops the write instead of freezing the defaults into a
 * record, and two invoices issued at the same moment can't both stand.
 */
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { resetDemoData } = await import("../lib/demo-seed/index.ts");
const { issueInvoice, loadMoney } = await import("../lib/money-server.ts");
const { setInstallDates } = await import("../lib/booking-server.ts");
const { SETTINGS_UNAVAILABLE, SettingsUnavailableError, getSettings, getSettingsStrict, settingsForWrite } = await import("../lib/settings-server.ts");
const invoicesRepo = await import("../lib/repo/invoices.ts");
const settingsRepo = await import("../lib/repo/settings.ts");

const OFFICE: StaffMember = { id: "aa000000-0000-4000-8000-0000000000c1", email: "office@demo.dang.invalid", name: "DEMO Office", roles: ["admin"], external: false, active: true, qualifications: [] };
const rid = () => crypto.randomUUID();
const EARLY = "DEMO: billing before the install for the test";

async function demo3(): Promise<string> {
  const summary = await resetDemoData({ now: new Date().toISOString() });
  return summary.projects.find((p) => p.label.startsWith("DEMO 3"))!.id;
}

/** Every read of the settings table fails, as on a Supabase blip. */
const settingsDown = <T>(fn: () => Promise<T>) => interceptTable("settings", () => failingQuery({ message: "DEMO: connection reset", code: "08006" }), fn);

test("settings that can't be read: pages get the defaults, writes refuse instead of freezing them", async () => {
  const id = await demo3();
  // The business's own details, saved: what a contract or invoice must carry.
  const live = await getSettings();
  await settingsRepo.setValue(settingsRepo.PILOT_SETTINGS_KEY, mergeSettings({ ...live, company: { ...live.company, legalName: "DEMO Heat Pumps Ltd" } }), "test");
  assert.equal((await getSettingsStrict()).company.legalName, "DEMO Heat Pumps Ltd");
  const before = (await invoicesRepo.listForProject(id)).length;

  await settingsDown(async () => {
    // Reading: the conservative defaults, so a page still renders.
    assert.equal((await getSettings()).company.legalName, DEFAULT_SETTINGS.company.legalName);
    // Writing: refused, with a message to try again.
    await assert.rejects(getSettingsStrict(), (err: unknown) => err instanceof SettingsUnavailableError && err.message === SETTINGS_UNAVAILABLE);
    assert.equal(await settingsForWrite(), null);
    const invoice = await issueInvoice(id, { kind: "balance", requestId: rid(), earlyReason: EARLY }, OFFICE);
    assert.ok(!invoice.ok && invoice.status === 503 && invoice.error === SETTINGS_UNAVAILABLE, JSON.stringify(invoice));
    const dates = await setInstallDates(id, "2027-02-02", OFFICE);
    assert.ok(!dates.ok && dates.status === 503, JSON.stringify(dates));
  });
  assert.equal((await invoicesRepo.listForProject(id)).length, before, "no invoice was made on the defaults");

  // Back up: the same request goes through on the real settings.
  const invoice = await issueInvoice(id, { kind: "balance", requestId: rid(), earlyReason: EARLY }, OFFICE);
  assert.ok(invoice.ok, !invoice.ok ? invoice.error : "");
});

test("two balance invoices issued at the same moment: one stands, the other is refused", async () => {
  const id = await demo3();
  const before = await invoicesRepo.listForProject(id);
  const plan = (await loadMoney(id))!.plans.balance;
  assert.ok(plan.totalPence > 0);
  const [a, b] = await Promise.all([
    issueInvoice(id, { kind: "balance", requestId: rid(), expectedTotalPence: plan.totalPence, earlyReason: EARLY }, OFFICE),
    issueInvoice(id, { kind: "balance", requestId: rid(), expectedTotalPence: plan.totalPence, earlyReason: EARLY }, OFFICE),
  ]);
  const after = await invoicesRepo.listForProject(id);
  const balances = after.filter((i) => i.kind === "balance");
  assert.equal(balances.length, 1, "one balance invoice for the balance");
  assert.equal(after.length, before.length + 1);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  const refused = [a, b].find((r) => !r.ok)!;
  assert.ok(!refused.ok && /at the same moment|already invoiced/.test(refused.error), !refused.ok ? refused.error : "");
  assert.equal(balances[0]!.issueKey, String(before.length), "planned on the invoices before it");
});

test("a double tap (one request, twice at once) issues one invoice and answers both with it", async () => {
  const id = await demo3();
  const requestId = rid();
  const [a, b] = await Promise.all([
    issueInvoice(id, { kind: "balance", requestId, earlyReason: EARLY }, OFFICE),
    issueInvoice(id, { kind: "balance", requestId, earlyReason: EARLY }, OFFICE),
  ]);
  assert.ok(a.ok && b.ok, JSON.stringify([a, b]));
  assert.equal(a.value.id, b.value.id);
  assert.equal((await invoicesRepo.listForProject(id)).filter((i) => i.requestId === requestId).length, 1);
});

test("the invoices table itself refuses a second invoice on the same request or the same plan", async () => {
  const projects = (await resetDemoData({ now: new Date().toISOString() })).projects;
  const id = projects.find((p) => p.label.startsWith("DEMO 3"))!.id;
  const other = projects.find((p) => p.label.startsWith("DEMO 5"))!.id;
  const base = {
    projectId: id,
    kind: "change-fee" as const,
    status: "issued" as const,
    lines: [],
    netPence: 100,
    taxPence: 0,
    totalPence: 100,
    paidPence: 0,
  };
  const first = await invoicesRepo.insertNumbered({ ...base, id: rid(), requestId: "demo-request-1", issueKey: "demo-plan-1" });
  await assert.rejects(
    invoicesRepo.insertNumbered({ ...base, id: rid(), requestId: "demo-request-1" }),
    (err: unknown) => err instanceof invoicesRepo.InvoiceClashError && err.clash === "request",
  );
  await assert.rejects(
    invoicesRepo.insertNumbered({ ...base, id: rid(), issueKey: "demo-plan-1" }),
    (err: unknown) => err instanceof invoicesRepo.InvoiceClashError && err.clash === "plan",
  );
  // A plan key is per project, and invoices without the keys (older ones) never clash.
  await invoicesRepo.insertNumbered({ ...base, projectId: other, id: rid(), issueKey: "demo-plan-1" });
  await invoicesRepo.insertNumbered({ ...base, id: rid() });
  await invoicesRepo.insertNumbered({ ...base, id: rid() });
  assert.ok(first.number);
});
