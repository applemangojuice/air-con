import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockersFor,
  currentStage,
  migrateProject,
  projectShortId,
  scoreInstallation,
  type Project,
} from "@aircon/domain";
import { registerAppResolver } from "./helpers/resolve-app.ts";

// The real seed on the in-memory local backend: nothing touches disk or a real database.
process.env.DATA_BACKEND = "memory";
delete process.env.SUPABASE_URL;
registerAppResolver();
const { buildDemoDataset, resetDemoData, isDevSeedRequest, findDemoProjectIds } = await import("../lib/demo-seed/index.ts");
const { demoId, isDemoSeedId } = await import("../lib/demo-seed/ids.ts");
const { addDays } = await import("../lib/demo-seed/dates.ts");
const { requireDb } = await import("../lib/supabase-server.ts");
const { listDocuments } = await import("../lib/documents-server.ts");
const { signedMediaUrls } = await import("../lib/media-server.ts");
const mediaRepo = await import("../lib/repo/media.ts");

const NOW = "2026-10-18T10:00:00.000Z"; // a Sunday
const EXPECTED_STAGES = ["survey", "proposal", "install", "proposal", "aftercare"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isChronological = (p: Project) => p.events.every((e, i) => i === 0 || p.events[i - 1]!.at <= e.at);

test("demo ids: deterministic, valid, marked, and distinct where refs need them", () => {
  assert.equal(demoId("project:1"), demoId("project:1"));
  assert.notEqual(demoId("project:1"), demoId("project:2"));
  assert.match(demoId("x"), UUID);
  assert.equal(isDemoSeedId(demoId("x")), true);
  assert.equal(isDemoSeedId(crypto.randomUUID()), false);
});

test("the dataset builds without throwing, every project is a consistent v2 snapshot at the right stage", () => {
  const data = buildDemoDataset({ now: NOW });
  assert.equal(data.projects.length, 5);
  assert.deepEqual(data.projects.map((p) => currentStage(p.project)), EXPECTED_STAGES);

  for (const dp of data.projects) {
    const p = dp.project;
    assert.deepEqual(migrateProject(p), p, `${dp.label}: migrateProject is a no-op on the seed`);
    assert.equal(p.schemaVersion, 2);
    assert.ok(p.pilot?.label.startsWith("DEMO"), dp.label);
    assert.ok(p.customer.name.endsWith("(DEMO)"), p.customer.name);
    assert.ok(p.customer.email?.endsWith("@example.com"));
    assert.match(p.customer.addressLine, /Demo/);
    assert.equal(dp.quote.source, "demo");
    assert.ok(isChronological(p), `${dp.label}: events in time order`);
    assert.ok(p.events.every((e) => e.at < NOW), `${dp.label}: nothing in the future`);
    for (const id of [p.id, p.quoteId, dp.customer.id, ...dp.media.map((m) => m.item.id), ...dp.documents.map((d) => d.id)]) {
      assert.match(id, UUID);
    }
    for (const m of dp.media) {
      assert.match(m.svg, /^<svg[\s\S]*DEMO PHOTO · [\s\S]*<\/svg>$/);
      // Well-formed enough for a browser: no element repeats an attribute (that's an XML error, a broken image).
      for (const [, attrs] of m.svg.matchAll(/<[a-zA-Z]+((?:\s+[a-zA-Z:-]+="[^"]*")*)\s*\/?>/g)) {
        const names = [...attrs!.matchAll(/([a-zA-Z:-]+)="/g)].map((x) => x[1]);
        assert.equal(new Set(names).size, names.length, `${m.fileName}: duplicate attribute in ${attrs}`);
      }
      assert.equal(m.item.storagePath, `${p.id}/${m.item.id}-${m.fileName}`);
    }
  }
  const shorts = data.projects.map((p) => projectShortId(p.project.id));
  assert.equal(new Set(shorts).size, 5, "document refs can't collide across demo projects");
  assert.ok(data.catalogue.every((c) => c.id.startsWith("demo-") && c.label.includes("(DEMO)") && c.confidence === "provisional"));
  assert.ok(data.compatibility.every((r) => r.id.startsWith("demo-")));

  // Pure: the same input gives the same dataset.
  assert.deepEqual(buildDemoDataset({ now: NOW }), data);
});

test("each scenario is what it says", () => {
  const [one, two, three, four, five] = buildDemoDataset({ now: NOW }).projects as [
    ReturnType<typeof buildDemoDataset>["projects"][number],
    ...ReturnType<typeof buildDemoDataset>["projects"],
  ];

  // DEMO 1: survey booked, in person, three days out, SW16.
  assert.equal(one!.project.survey.status, "booked");
  assert.equal(one!.project.survey.mode, "in-person");
  assert.equal(one!.project.survey.scheduledFor, "2026-10-21T10:00:00.000Z");
  assert.match(one!.project.customer.postcode, /^SW16 /);
  assert.equal(one!.project.quoteSummary.roomCount, 1);

  // DEMO 2: two measured rooms, approved design with two variants, two priced options, PILOT15, ~30% margin.
  assert.equal(two!.survey?.data.rooms.length, 2);
  assert.equal(two!.design?.status, "approved");
  assert.deepEqual(two!.design?.variants.map((v) => v.tier), ["standard", "premium"]);
  assert.equal(two!.project.proposal.status, "issued");
  assert.equal(two!.proposal?.options.length, 2);
  for (const o of two!.proposal!.options) {
    assert.ok(o.costLines.length > 5);
    assert.equal(o.pricing.discount?.code, "PILOT15");
    assert.ok(o.pricing.grossMarginPct >= 28 && o.pricing.grossMarginPct <= 32, String(o.pricing.grossMarginPct));
    assert.equal(o.pricing.belowMinMargin, false);
    assert.equal(o.priceLines.reduce((s, l) => s + l.amountPence, 0), o.pricing.totalPence, "price lines add up");
  }

  // DEMO 3: accepted with early start evidenced, booked next week, crew qualified, kit in, compliance approved: ready.
  const p3 = three!.project;
  assert.equal(p3.proposal.status, "accepted");
  assert.ok(p3.proposal.earlyStart?.evidencedAt);
  assert.equal(p3.booking.status, "booked");
  assert.equal(p3.booking.dates.length, 3);
  assert.ok(p3.booking.dates[0]! > addDays("2026-10-18", 5));
  assert.equal(p3.kit.status, "inspected");
  assert.ok(three!.purchaseOrders.every((po) => po.status === "inspected" && po.lines.every((l) => l.inspectedQty === l.qty)));
  const ready = blockersFor(p3, three!.ctx, "ready-to-install").filter((b) => b.severity === "block");
  assert.deepEqual(ready, [], "nothing blocks day 1");
  assert.ok(p3.booking.crew.some((m) => m.role === "tech-lead") && p3.booking.crew.some((m) => m.role === "electrician"));

  // DEMO 4: survey with a loft route, design in review with an override, and a blocking issue for the tech lead.
  assert.ok(four!.survey?.data.rooms.some((r) => r.route === "via-loft"));
  assert.equal(four!.project.design.status, "in-review");
  assert.equal(four!.design?.overrides.length, 1);
  assert.ok(four!.design!.overrides[0]!.reason.length > 20);
  const issue = four!.issues[0]!;
  assert.equal(issue.title, "Pipe route through loft needs tech-lead review");
  assert.equal(issue.blocking, true);
  assert.equal(issue.status, "open");
  assert.ok(blockersFor(four!.project, four!.ctx, "proposal-issue").some((b) => b.code === `issue:${issue.id}`));

  // DEMO 5: handed over ten days ago, commissioned, paid, closed, 9/10.
  const p5 = five!.project;
  assert.equal(p5.handover.status, "handed-over");
  assert.equal(p5.handover.handedOverAt?.slice(0, 10), "2026-10-08");
  assert.equal(p5.closure.closed, true);
  assert.equal(p5.money.paidPence, p5.money.contractTotalPence);
  assert.equal(p5.money.invoicedPence, p5.money.contractTotalPence);
  assert.deepEqual(five!.invoices.map((i) => i.kind), ["deposit", "balance"]);
  assert.ok(five!.payments.every((x) => x.provider === "demo" && x.status === "succeeded"));
  assert.equal(p5.aftercare.feedback?.score, 9);
  assert.equal(five!.issues[0]!.status, "resolved");
  assert.ok(five!.time.some((t) => t.kind === "survey") && five!.time.some((t) => t.kind === "install") && five!.time.some((t) => t.kind === "travel"));
  assert.ok(five!.learnings.length >= 1);
  assert.ok(five!.messages.length > 5 && five!.messages.every((m) => m.status === "demo"));
  const job = five!.installJob!;
  const card = scoreInstallation({ ...job, customer: "", postcode: "", engineer: "", scheduledOn: "", evidence: five!.evidence });
  assert.equal(card.completenessPct, 100);
  assert.equal(card.exceptions.length, 0);
  assert.ok(job.commissioning?.signedBy.qualificationRef);
  const kinds = five!.documents.map((d) => d.kind);
  for (const k of ["handover-pack", "commissioning-certificate", "contract", "invoice", "receipt"] as const) assert.ok(kinds.includes(k), k);
  const pack = five!.documents.find((d) => d.kind === "handover-pack")!;
  assert.equal(p5.handover.packDocumentId, pack.id);
  const snap = pack.snapshot as import("@aircon/domain").HandoverPackSnapshot;
  assert.equal(snap.electricalCert.dueBy, "2026-11-07", "30 days after completion");
  assert.equal(snap.maintenanceInfo.dueBy, "2026-10-13", "5 days after completion");
  assert.ok(snap.fgas[0]!.tco2e > 0);
  assert.ok(snap.documents.length >= 3);
  // Refs are unique, and the invoices are separate series.
  const refs = five!.documents.map((d) => d.ref);
  assert.equal(new Set(refs).size, refs.length);
});

test("annotated photos: indoor walls and outdoor spots carry drawings; approved layouts are locked", () => {
  const data = buildDemoDataset({ now: NOW });
  const media = data.projects.flatMap((p) => p.media.map((m) => ({ ...m.item, project: p.n })));
  for (const tag of ["indoor-wall", "outdoor-location"] as const) {
    const drawn = media.filter((m) => m.tag === tag && m.annotations.length > 0);
    assert.ok(drawn.length >= 4, `${tag}: ${drawn.length}`);
    for (const m of drawn) {
      for (const a of m.annotations) {
        const xs = "x" in a ? [a.x, a.y] : a.type === "route" ? a.points.flatMap((pt) => [pt.x, pt.y]) : [a.from.x, a.from.y, a.to.x, a.to.y];
        assert.ok(xs.every((n) => n >= 0 && n <= 1), `${m.id} ${a.type}`);
      }
    }
  }
  assert.ok(media.filter((m) => m.project === 2 && m.tag === "indoor-wall").every((m) => m.locked), "DEMO 2's approved layout is locked");
  assert.ok(media.filter((m) => m.project === 4).every((m) => !m.locked), "DEMO 4's design is still in review");
});

test("the calendar holds on every day of the week and across a month end", () => {
  for (let d = 0; d < 9; d++) {
    const now = `${addDays("2026-12-24", d)}T10:00:00.000Z`;
    const data = buildDemoDataset({ now });
    assert.deepEqual(data.projects.map((p) => currentStage(p.project)), EXPECTED_STAGES, now);
    assert.ok(data.projects.every((p) => isChronological(p.project) && p.project.events.every((e) => e.at < now)), now);
  }
});

test("isDevSeedRequest: development, the login button's header, same origin", () => {
  const req = (headers: Record<string, string>) => ({ headers: new Headers(headers), url: "http://localhost:3000/api/dev/seed" });
  const dev = { NODE_ENV: "development" };
  assert.equal(isDevSeedRequest(dev, req({ "x-dih-seed": "login", origin: "http://localhost:3000" })), true);
  assert.equal(isDevSeedRequest(dev, req({ "x-dih-seed": "login", "sec-fetch-site": "same-origin" })), true);
  assert.equal(isDevSeedRequest({ NODE_ENV: "production" }, req({ "x-dih-seed": "login", origin: "http://localhost:3000" })), false);
  assert.equal(isDevSeedRequest(dev, req({ origin: "http://localhost:3000" })), false, "no header");
  assert.equal(isDevSeedRequest(dev, req({ "x-dih-seed": "login", origin: "https://evil.example" })), false);
  assert.equal(isDevSeedRequest(dev, req({ "x-dih-seed": "login", "sec-fetch-site": "cross-site", origin: "http://localhost:3000" })), false);
  assert.equal(isDevSeedRequest(dev, req({ "x-dih-seed": "login" })), false, "no origin evidence at all");
});

test("reset on the local backend: writes everything, replaces only demo data, and is repeatable", async () => {
  const db = requireDb();
  // Someone's real (non-demo) quote and project: a reset must leave them alone.
  const realQuote = crypto.randomUUID();
  const realProject = crypto.randomUUID();
  await db.from("quote_requests").insert({ id: realQuote, customer_name: "Real person", email: "real@example.org", source: "web", survey: {}, quote: {} });
  await db.from("projects").insert({ id: realProject, quote_id: realQuote, project: { schemaVersion: 2 } });
  await db.from("catalogue_items").insert({ id: "real-item", kind: "indoor", label: "Real item", item: {} });

  const first = await resetDemoData({ now: NOW });
  assert.equal(first.projects.length, 5);
  const second = await resetDemoData({ now: NOW });
  assert.equal(second.cleared, 5, "the second reset replaced the first set");

  const ids = await findDemoProjectIds();
  assert.equal(ids.length, 5);
  const { data: rows } = await db.from("projects").select("*").in("id", ids);
  const dataset = buildDemoDataset({ now: NOW });
  for (const dp of dataset.projects) {
    const row = (rows ?? []).find((r) => r.id === dp.project.id)!;
    assert.ok(row, dp.label);
    assert.deepEqual(migrateProject(row.project), dp.project, `${dp.label} round-trips`);
    assert.equal(row.current_stage, currentStage(dp.project));
    assert.equal(row.customer_id, dp.customer.id);

    const docs = await listDocuments(dp.project.id, { customerVisibleOnly: true });
    assert.equal(docs.length, dp.documents.length, `${dp.label} documents`);
    assert.deepEqual(new Set(docs.map((d) => d.ref)), new Set(dp.documents.map((d) => d.ref)));

    const items = await mediaRepo.listForProject(dp.project.id);
    assert.equal(items.length, dp.media.length);
    const urls = await signedMediaUrls(items);
    assert.equal(urls.size, items.length, `${dp.label}: every photo has its file`);
  }

  // Counts per table: exactly one set, not two.
  const count = async (table: string) => ((await db.from(table).select("id").in("project_id", ids)).data ?? []).length;
  const expect = (pick: (dp: (typeof dataset.projects)[number]) => unknown[]) => dataset.projects.reduce((s, dp) => s + pick(dp).length, 0);
  assert.equal(await count("compliance_items"), expect((dp) => dp.compliance));
  assert.equal(await count("install_evidence"), expect((dp) => dp.evidence));
  assert.equal(await count("messages"), expect((dp) => dp.messages));
  assert.equal(await count("invoices"), expect((dp) => dp.invoices));
  assert.equal(((await db.from("quote_requests").select("id").eq("source", "demo")).data ?? []).length, 5);

  // Untouched.
  assert.ok((await db.from("projects").select("id").eq("id", realProject).maybeSingle()).data);
  assert.ok((await db.from("quote_requests").select("id").eq("id", realQuote).maybeSingle()).data);
  assert.ok((await db.from("catalogue_items").select("id").eq("id", "real-item").maybeSingle()).data);
  // The demo team exists for "Try as…".
  assert.equal(((await db.from("staff").select("id").eq("demo", true)).data ?? []).length, 6);
});
