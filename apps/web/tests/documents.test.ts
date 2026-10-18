import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, documentCompany, type DocumentRecord, type DocumentSnapshots, type Invoice } from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// The real modules, on the in-memory local backend.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { createDocument, documentInstance, documentSeries, listDocuments, planDocument, getDocument, currentDocument, isCustomerVisible } =
  await import("../lib/documents-server.ts");
const { requireDb } = await import("../lib/supabase-server.ts");

const PROJECT = "7f3a91c2-1111-4111-8111-000000000001";
const OTHER = "0b0b0b0b-2222-4222-8222-000000000002";

/** A stored-looking document for the pure planner. DEMO data only. */
const doc = (over: Partial<DocumentRecord> & Pick<DocumentRecord, "kind" | "ref" | "version">): DocumentRecord => ({
  id: `${over.ref}-id`,
  projectId: PROJECT,
  title: "DEMO",
  status: "final",
  customerVisible: true,
  snapshot: {},
  createdAt: "2026-10-01T09:00:00.000Z",
  ...over,
});

const header = { company: documentCompany(DEFAULT_SETTINGS), customer: { name: "Sam (DEMO)", addressLine: "1 Demo Street", postcode: "SW16 9ZZ" }, issuedAt: "2026-10-01T09:00:00.000Z" };

const invoice = (number: string, totalPence = 10_000): Invoice => ({
  id: `inv-${number}`,
  projectId: PROJECT,
  number,
  kind: "deposit",
  status: "issued",
  lines: [{ label: "Deposit (DEMO)", netPence: totalPence, taxCode: "outside-scope", taxPence: 0, totalPence }],
  netPence: totalPence,
  taxPence: 0,
  totalPence,
  paidPence: 0,
});

const invoiceSnapshot = (number: string): DocumentSnapshots["invoice"] => ({ ...header, invoice: invoice(number), payments: [] });

test("planDocument: a one-per-project kind versions up and supersedes the live version", () => {
  const first = planDocument({ existing: [], projectId: PROJECT, kind: "handover-pack" });
  assert.deepEqual([first.version, first.ref, first.supersede.length], [1, "DIH-HP-7F3A91C2-v1", 0]);

  const v1 = doc({ kind: "handover-pack", ref: first.ref, version: 1 });
  const second = planDocument({ existing: [v1], projectId: PROJECT, kind: "handover-pack" });
  assert.equal(second.version, 2);
  assert.equal(second.ref, "DIH-HP-7F3A91C2-v2");
  assert.deepEqual(second.supersede.map((d) => d.ref), [v1.ref]);

  // Superseded versions still count for numbering, but aren't superseded twice.
  const v2 = doc({ kind: "handover-pack", ref: second.ref, version: 2 });
  const third = planDocument({ existing: [{ ...v1, status: "superseded" }, v2], projectId: PROJECT, kind: "handover-pack" });
  assert.equal(third.version, 3);
  assert.deepEqual(third.supersede.map((d) => d.ref), [v2.ref]);
});

test("planDocument: a draft supersedes nothing", () => {
  const v1 = doc({ kind: "proposal", ref: "DIH-PR-7F3A91C2-v1", version: 1 });
  const draft = planDocument({ existing: [v1], projectId: PROJECT, kind: "proposal", status: "draft" });
  assert.equal(draft.version, 2);
  assert.equal(draft.supersede.length, 0);
});

test("planDocument: invoices are separate series that never supersede each other", () => {
  const one = planDocument({ existing: [], projectId: PROJECT, kind: "invoice", instance: "0001" });
  const inv1 = doc({ kind: "invoice", ref: one.ref, version: 1 });
  const two = planDocument({ existing: [inv1], projectId: PROJECT, kind: "invoice", instance: "0002" });
  assert.equal(two.version, 1, "a new invoice is version 1 of its own series");
  assert.notEqual(two.ref, one.ref);
  assert.equal(two.supersede.length, 0);

  // A corrected invoice 1 is invoice 1 v2, and replaces only invoice 1.
  const inv2 = doc({ kind: "invoice", ref: two.ref, version: 1 });
  const fixed = planDocument({ existing: [inv1, inv2], projectId: PROJECT, kind: "invoice", instance: "0001" });
  assert.equal(fixed.version, 2);
  assert.equal(fixed.ref, "DIH-IN-7F3A91C2-0001-v2");
  assert.deepEqual(fixed.supersede.map((d) => d.ref), [inv1.ref]);

  // Other projects' documents never count.
  const elsewhere = doc({ kind: "invoice", ref: "DIH-IN-0B0B0B0B-0001-v1", version: 1, projectId: OTHER });
  assert.equal(planDocument({ existing: [elsewhere], projectId: PROJECT, kind: "invoice", instance: "0001" }).version, 1);
});

test("planDocument: a repeatable kind without an instance is refused", () => {
  for (const kind of ["invoice", "receipt", "variation"] as const) {
    assert.throws(() => planDocument({ existing: [], projectId: PROJECT, kind }), /needs an instance/);
  }
  assert.throws(() => planDocument({ existing: [], projectId: PROJECT, kind: "invoice", instance: "--" }), /needs an instance/);
});

test("documentInstance and documentSeries", () => {
  assert.equal(documentInstance("invoice", invoiceSnapshot("DIH-0002")), "0002");
  assert.equal(documentInstance("invoice", invoiceSnapshot("DEMO-0017")), "0017");
  const receipt: DocumentSnapshots["receipt"] = {
    ...header,
    payment: { id: "ab12cd34-0000-4000-8000-000000000000", projectId: PROJECT, method: "card", provider: "demo", providerRef: "DEMO-1", amountPence: 100, status: "succeeded", receivedAt: header.issuedAt },
  };
  assert.equal(documentInstance("receipt", receipt), "AB12CD34");
  const variation = {
    ...header,
    issue: { id: "i1", number: 3, kind: "variation" as const, title: "Extra unit (DEMO)", raisedAt: header.issuedAt, mediaIds: [], variation: { description: "DEMO", priceDeltaNetPence: 100, taxPence: 0, totalDeltaPence: 100, status: "proposed" as const } },
  };
  assert.equal(documentInstance("variation", variation), "3");
  assert.equal(documentInstance("proposal", { ...header, proposal: {} as never }), undefined);
  assert.equal(documentSeries("DIH-IN-7F3A91C2-0002-v3"), "DIH-IN-7F3A91C2-0002");
  assert.equal(documentSeries("DIH-PR-7F3A91C2-v12"), "DIH-PR-7F3A91C2");
});

test("isCustomerVisible: visible and not a draft", () => {
  assert.equal(isCustomerVisible({ customerVisible: true, status: "final" }), true);
  assert.equal(isCustomerVisible({ customerVisible: true, status: "superseded" }), true);
  assert.equal(isCustomerVisible({ customerVisible: true, status: "draft" }), false);
  assert.equal(isCustomerVisible({ customerVisible: false, status: "final" }), false);
});

test("createDocument: versions, supersession and listing on the local backend", async () => {
  const projectId = "5c5c5c5c-3333-4333-8333-000000000003";
  // documents.project_id references projects: give it one (the memory backend doesn't check, Postgres would).
  await requireDb().from("projects").insert({ id: projectId, quote_id: crypto.randomUUID(), project: {} });

  const surveySnapshot = { ...header, survey: { id: "s", projectId, version: 1, status: "submitted" as const, data: {} as never }, promises: ["DEMO"] };
  const first = await createDocument(projectId, "survey-report", surveySnapshot, { title: "Survey report", customerVisible: true, createdBy: "DEMO" });
  const second = await createDocument(projectId, "survey-report", surveySnapshot, { title: "Survey report", customerVisible: true });
  assert.equal(first.version, 1);
  assert.equal(second.version, 2);
  assert.equal((await getDocument(first.id))?.status, "superseded");
  assert.equal((await currentDocument(projectId, "survey-report"))?.id, second.id);

  const a = await createDocument(projectId, "invoice", invoiceSnapshot("DEMO-0101"), { title: "Invoice 101", customerVisible: true });
  const b = await createDocument(projectId, "invoice", invoiceSnapshot("DEMO-0102"), { title: "Invoice 102", customerVisible: true });
  assert.deepEqual([a.version, b.version], [1, 1]);
  assert.notEqual(a.ref, b.ref);
  assert.equal((await getDocument(a.id))?.status, "final", "a second invoice never supersedes the first");

  const draft = await createDocument(projectId, "proposal", { ...header, proposal: {} as never }, { title: "Draft", customerVisible: true, status: "draft" });
  const hidden = await createDocument(projectId, "commissioning-certificate", { ...header, commissioning: {} as never, equipment: [] }, { title: "Internal", customerVisible: false });

  const all = await listDocuments(projectId);
  assert.deepEqual(new Set(all.map((d) => d.id)), new Set([second.id, a.id, b.id, draft.id, hidden.id]), "current versions only by default");
  const customer = await listDocuments(projectId, { customerVisibleOnly: true });
  assert.deepEqual(new Set(customer.map((d) => d.id)), new Set([second.id, a.id, b.id]), "no drafts, nothing internal");
  assert.equal((await listDocuments(projectId, { includeSuperseded: true })).length, 6);

  // The snapshot is stored JSON-clean and comes back as written.
  const read = await getDocument(b.id);
  assert.deepEqual(read?.snapshot, JSON.parse(JSON.stringify(invoiceSnapshot("DEMO-0102"))));
  await assert.rejects(createDocument("not-a-uuid", "proposal", { ...header, proposal: {} as never }, { title: "x", customerVisible: false }), /not a project id/);
});
