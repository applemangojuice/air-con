import {
  PROJECT_SCHEMA_VERSION,
  blockersFor,
  currentStage,
  nextGate,
  type PilotSettings,
  type Project,
  type ReadinessContext,
} from "@aircon/domain";
import { DEMO_STAFF } from "../auth/demo-staff.ts";
import { createDocument } from "../documents-server";
import { storeSystemMedia } from "../media-server";
import { db, isUuid, must, uuidOrNull, type Row } from "../repo/base";
import * as catalogueRepo from "../repo/catalogue";
import * as compatibilityRepo from "../repo/compatibility";
import * as complianceRepo from "../repo/compliance";
import * as designsRepo from "../repo/designs";
import * as evidenceRepo from "../repo/evidence";
import * as installJobsRepo from "../repo/installJobs";
import * as invoicesRepo from "../repo/invoices";
import * as issuesRepo from "../repo/issues";
import * as learningsRepo from "../repo/learnings";
import * as messagesRepo from "../repo/messages";
import * as paymentsRepo from "../repo/payments";
import * as proposalsRepo from "../repo/proposals";
import * as purchaseOrdersRepo from "../repo/purchaseOrders";
import * as staffRepo from "../repo/staff";
import * as surveysRepo from "../repo/surveys";
import * as timeRepo from "../repo/time";
import { DEMO_CUSTOMER_EMAILS, DEMO_PROJECT_IDS, DemoSeedError, buildDemoDataset, type DemoDataset, type DemoProject } from "./builder.ts";

export { buildDemoDataset, DemoSeedError, type DemoDataset, type DemoProject } from "./builder.ts";

/**
 * Reset the DEMO pilots (plan §J: "reset demo data", development and demo
 * deployments only; the route and the login button check that, not this).
 *
 *   const summary = await resetDemoData({ now: new Date().toISOString(), settings });
 *
 * 1. Build the whole dataset first (pure; throws if the story is
 *    inconsistent), so a bug never wipes the old demo without a replacement.
 * 2. Delete ONLY demo data: projects whose quote has `source = 'demo'` (and
 *    the seed's own fixed project ids), everything hanging off them, their
 *    files in project-media, the demo customers (@example.com, only once no
 *    other project is theirs) and catalogue rows with a `demo-` id.
 * 3. Write the dataset through the repositories, so every row has exactly
 *    the shape the app reads. Documents go through createDocument and media
 *    through storeSystemMedia: the same numbering and paths as live data.
 *
 * The DEMO staff ("Try as…" accounts) are created when missing, never
 * deleted: someone may be signed in as one.
 */

export interface DemoSeedSummary {
  at: string;
  cleared: number;
  projects: { id: string; label: string; stage: string; customer: string; url: string }[];
}

/** Every project-owned table, children first. */
const PROJECT_TABLES = [
  "install_evidence",
  "install_jobs",
  "media",
  "surveys",
  "designs",
  "proposals",
  "compliance_items",
  "purchase_orders",
  "issues",
  "time_entries",
  "payments",
  "invoices",
  "messages",
  "documents",
  "learnings",
] as const;

/** Is this a request from the dev login page's "Load demo pilots" button? Never in production. */
export function isDevSeedRequest(
  env: Record<string, string | undefined>,
  request: { headers: Headers; url: string },
): boolean {
  if (env.NODE_ENV === "production") return false;
  if (request.headers.get("x-dih-seed") !== "login") return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return site === "same-origin";
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** The ids of every demo project currently stored. */
export async function findDemoProjectIds(): Promise<string[]> {
  const quotes = must(await db().from("quote_requests").select("id").eq("source", "demo"), "demo quotes") ?? [];
  const quoteIds = quotes.map((q) => String((q as Row).id)).filter(isUuid);
  const ids = new Set<string>();
  if (quoteIds.length) {
    const rows = must(await db().from("projects").select("id").in("quote_id", quoteIds), "demo projects") ?? [];
    for (const r of rows) ids.add(String((r as Row).id));
  }
  const fixed = must(await db().from("projects").select("id").in("id", [...DEMO_PROJECT_IDS]), "demo fixed projects") ?? [];
  for (const r of fixed) ids.add(String((r as Row).id));
  return [...ids];
}

/** Delete the demo data, and only that. Returns how many demo projects went. */
export async function clearDemoData(): Promise<number> {
  const ids = await findDemoProjectIds();
  if (ids.length) {
    const files = must(await db().from("media").select("bucket, storage_path").in("project_id", ids), "demo media") ?? [];
    const byBucket = new Map<string, string[]>();
    for (const f of files as Row[]) {
      const bucket = String(f.bucket ?? "project-media");
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), String(f.storage_path)]);
    }
    for (const [bucket, paths] of byBucket) {
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await db().storage.from(bucket).remove(paths.slice(i, i + 100));
        if (error) console.warn(`[demo-seed] removing demo files from ${bucket}:`, error.message);
      }
    }
    for (const table of PROJECT_TABLES) {
      must(await db().from(table).delete().in("project_id", ids), `demo clear ${table}`);
    }
    must(await db().from("projects").delete().in("id", ids), "demo clear projects");
  }
  must(await db().from("quote_requests").delete().eq("source", "demo"), "demo clear quotes");

  for (const email of DEMO_CUSTOMER_EMAILS) {
    const customer = must(await db().from("customers").select("id").eq("email", email).maybeSingle(), "demo customer");
    if (!customer) continue;
    const customerId = String((customer as Row).id);
    const others = must(await db().from("projects").select("id").eq("customer_id", customerId), "demo customer projects") ?? [];
    if (others.length) continue; // someone gave a real project a demo address: leave the customer be
    must(await db().from("login_tokens").delete().eq("email", email), "demo login tokens");
    must(await db().from("customers").delete().eq("id", customerId), "demo customer delete");
  }

  must(await db().from("catalogue_compatibility").delete().like("id", "demo-%"), "demo clear compatibility");
  must(await db().from("catalogue_items").delete().like("id", "demo-%"), "demo clear catalogue");
  return ids.length;
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

function isBlocked(p: Project, ctx: ReadinessContext): boolean {
  const gate = nextGate(p);
  return gate ? blockersFor(p, ctx, gate).some((b) => b.severity === "block") : false;
}

/** The projects row: the snapshot plus the board columns (mirrors project-service's denormalise). */
export function demoProjectRow(p: Project, ctx: ReadinessContext): Row {
  return {
    id: p.id,
    quote_id: p.quoteId,
    created_at: p.createdAt,
    schema_version: PROJECT_SCHEMA_VERSION,
    customer_name: p.customer.name || "",
    postcode: p.customer.postcode || "",
    current_stage: currentStage(p),
    completed: p.closure.closed,
    site_visit_at: p.survey.scheduledFor ?? null,
    delivery_expected_on: p.kit.expectedDate ?? null,
    install_on: p.booking.startDate ?? null,
    pilot_number: p.pilot?.number ?? null,
    owner_staff_id: uuidOrNull(p.owner?.staffId),
    next_action: p.nextAction?.text ?? null,
    next_action_at: p.nextAction?.dueOn ?? null,
    value_pence: p.money.contractTotalPence ?? Math.round(p.quoteSummary.totalGbp * 100),
    customer_id: isUuid(p.customer.customerId) ? p.customer.customerId : null,
    blocked: isBlocked(p, ctx),
    project: p,
  };
}

async function insertRows(table: string, rows: Row[], what: string): Promise<void> {
  if (rows.length === 0) return;
  must(await db().from(table).insert(rows), what);
}

/** The "Try as…" team, created when missing (existing rows are left exactly as they are). */
async function ensureDemoTeam(): Promise<void> {
  for (const demo of Object.values(DEMO_STAFF)) {
    if (await staffRepo.get(demo.id)) continue;
    try {
      await staffRepo.insert(demo, null);
    } catch (err) {
      if (!(await staffRepo.get(demo.id))) throw err;
    }
  }
}

async function writeProject(dp: DemoProject): Promise<void> {
  const p = dp.project;
  const createdAt = (iso?: string) => ({ created_at: iso ?? p.createdAt });

  await insertRows(
    "customers",
    [
      {
        id: dp.customer.id,
        email: dp.customer.email,
        name: dp.customer.name,
        phone: dp.customer.phone,
        ops_consent: { at: dp.customer.createdAt, source: "demo", text: "DEMO: agreed to project updates by email and SMS." },
        marketing_consent: null,
        created_at: dp.customer.createdAt,
      },
    ],
    "demo customer",
  );
  await insertRows("quote_requests", [dp.quote as unknown as Row], "demo quote");
  await insertRows("projects", [demoProjectRow(p, dp.ctx)], "demo project");

  if (dp.survey) await insertRows("surveys", [{ ...surveysRepo.toRow(dp.survey), ...createdAt(dp.survey.startedAt) }], "demo survey");
  if (dp.design) await insertRows("designs", [{ ...designsRepo.toRow(dp.design), ...createdAt(dp.design.createdAt) }], "demo design");
  if (dp.proposal) await insertRows("proposals", [{ ...proposalsRepo.toRow(dp.proposal), ...createdAt(dp.proposal.createdAt) }], "demo proposal");
  await insertRows("compliance_items", dp.compliance.map((c) => ({ ...complianceRepo.toRow(c), ...createdAt() })), "demo compliance");
  await insertRows(
    "purchase_orders",
    dp.purchaseOrders.map((po) => ({ ...purchaseOrdersRepo.toRow(po), ...createdAt(po.orderedOn ? `${po.orderedOn}T09:00:00.000Z` : undefined) })),
    "demo purchase orders",
  );
  if (dp.installJob) await installJobsRepo.save(dp.installJob);
  for (const e of dp.evidence) await evidenceRepo.appendIdempotent(p.id, e);
  await insertRows("issues", dp.issues.map((i) => ({ ...issuesRepo.toRow(i), ...createdAt(i.raisedAt) })), "demo issues");
  await insertRows("time_entries", dp.time.map((t) => ({ ...timeRepo.toRow(t), ...createdAt(t.startedAt) })), "demo time");
  await insertRows("invoices", dp.invoices.map((i) => ({ ...invoicesRepo.toRow(i), ...createdAt(i.issuedAt) })), "demo invoices");
  await insertRows("payments", dp.payments.map((x) => ({ ...paymentsRepo.toRow(x), ...createdAt(x.receivedAt) })), "demo payments");
  await insertRows("messages", dp.messages.map((m) => messagesRepo.messageToRow(m, m.createdAt)), "demo messages");
  await insertRows("learnings", dp.learnings.map((l) => ({ ...learningsRepo.toRow(l), ...createdAt(l.createdAt) })), "demo learnings");

  for (const m of dp.media) {
    const stored = await storeSystemMedia({
      projectId: p.id,
      mediaId: m.item.id,
      fileName: m.fileName,
      contentType: m.item.contentType,
      body: m.svg,
      tag: m.item.tag,
      ...(m.item.roomId ? { roomId: m.item.roomId } : {}),
      ...(m.item.caption ? { caption: m.item.caption } : {}),
      source: m.item.source,
      ...(m.item.takenBy ? { takenBy: m.item.takenBy } : {}),
      takenAt: m.item.takenAt,
      customerVisible: m.item.customerVisible,
      width: m.item.width,
      height: m.item.height,
      annotations: m.item.annotations,
      locked: m.item.locked,
    });
    if (stored.storagePath !== m.item.storagePath) {
      throw new DemoSeedError(`demo media path drifted: ${stored.storagePath} ≠ ${m.item.storagePath}`);
    }
  }

  // In issue order, so versions and refs come out exactly as the story planned them.
  for (const d of dp.documents) {
    const saved = await createDocument(p.id, d.kind, d.snapshot, {
      id: d.id,
      title: d.title,
      customerVisible: d.customerVisible,
      ...(d.createdBy ? { createdBy: d.createdBy } : {}),
      createdAt: d.createdAt,
    });
    if (saved.ref !== d.ref) throw new DemoSeedError(`demo document ref drifted: ${saved.ref} ≠ ${d.ref}`);
  }
}

/** Write a built dataset. The demo data must already be clear (see clearDemoData). */
export async function writeDemoData(dataset: DemoDataset): Promise<void> {
  await ensureDemoTeam();
  await catalogueRepo.upsertMany(dataset.catalogue);
  await compatibilityRepo.upsertMany(dataset.compatibility);
  for (const dp of dataset.projects) await writeProject(dp);
}

let running: Promise<DemoSeedSummary> | null = null;

/** Build, clear, write. One at a time per process: a double click waits for the first. */
export function resetDemoData(input: { now?: string; settings?: PilotSettings } = {}): Promise<DemoSeedSummary> {
  if (running) return running;
  running = (async () => {
    try {
      const now = input.now ?? new Date().toISOString();
      const dataset = buildDemoDataset({ now, ...(input.settings ? { settings: input.settings } : {}) });
      const cleared = await clearDemoData();
      await writeDemoData(dataset);
      return {
        at: now,
        cleared,
        projects: dataset.projects.map((dp) => ({
          id: dp.project.id,
          label: dp.label,
          stage: currentStage(dp.project),
          customer: dp.project.customer.name,
          url: `/ops/projects/${dp.project.id}`,
        })),
      };
    } finally {
      running = null;
    }
  })();
  return running;
}
