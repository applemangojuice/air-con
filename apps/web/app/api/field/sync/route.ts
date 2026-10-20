import { z } from "zod";
import { requireStaffApi } from "@/lib/auth/server";
import type { SyncOp } from "@/lib/field-outbox";
import { processSyncBatch } from "@/lib/field-server";
import { json, readJson } from "../_lib/http";

/**
 * POST /api/field/sync { ops: SyncOp[] } → { results: SyncResult[] }
 *
 * The phone's outbox, in batches. Every op carries an id made on the phone
 * and is idempotent (a repeat answers ok with `duplicate`), so a retry after
 * a lost response is harmless. Per-op access and qualification checks run
 * in processSyncBatch; this route checks who's asking.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);
const at = z.string().min(10).max(40);
const projectId = z.string().uuid();
const uuid = z.string().uuid();
/** Who made the capture on the phone: the server sends it back unsaved unless that's who's signed in. */
const by = z.object({ id: z.string().min(1).max(100), name: z.string().max(200) }).optional();

const opSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("evidence"),
    id,
    projectId,
    specId: z.string().min(1).max(160),
    value: z.number().finite().min(-100_000).max(1_000_000).optional(),
    ref: z.string().max(200).optional(),
    note: z.string().max(1000).optional(),
    mediaId: uuid.optional(),
    gps: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
    by,
    at,
  }),
  z.object({
    type: z.literal("step-status"),
    id,
    projectId,
    stepId: z.string().min(1).max(120),
    outcome: z.enum(["pass", "fail", "blocked", "na"]),
    reason: z.string().max(1000).optional(),
    issueId: uuid.optional(),
    by,
    at,
  }),
  z.object({
    type: z.literal("time-start"),
    id: uuid,
    projectId,
    kind: z.enum(["install", "travel", "commissioning", "handover"]),
    dayN: z.number().int().min(1).max(30).optional(),
    note: z.string().max(300).optional(),
    gps: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
    by,
    at,
  }),
  z.object({ type: z.literal("time-stop"), id, projectId, entryId: uuid, by, at }),
  z.object({
    type: z.literal("issue"),
    id: uuid,
    projectId,
    kind: z.enum(["defect", "snag", "shortage", "damage", "safety", "clarification", "variation", "customer-instruction", "blocker", "fault"]),
    title: z.string().trim().min(3).max(140),
    detail: z.string().max(2000).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]),
    blocking: z.boolean(),
    mediaIds: z.array(uuid).max(6),
    variation: z
      .object({ description: z.string().trim().min(3).max(2000), priceDeltaNetPence: z.number().int().min(-10_000_000).max(10_000_000), unitsUnchanged: z.boolean().optional() })
      .optional(),
    by,
    at,
  }),
]);

const bodySchema = z.object({ ops: z.array(z.unknown()).min(1).max(100) });

export async function POST(request: Request): Promise<Response> {
  const staff = await requireStaffApi(request, "install.work");
  if (staff instanceof Response) return staff;
  const body = bodySchema.safeParse(await readJson(request));
  if (!body.success) return json({ error: "Invalid request" }, 400);

  // Validate each op on its own: one bad op is refused for good, the rest still land.
  const valid: SyncOp[] = [];
  const invalid: { id: string; ok: false; error: string; permanent: true }[] = [];
  for (const raw of body.data.ops) {
    const parsed = opSchema.safeParse(raw);
    if (parsed.success) valid.push(parsed.data as SyncOp);
    else {
      const rawId = (raw as { id?: unknown } | null)?.id;
      invalid.push({ id: typeof rawId === "string" ? rawId.slice(0, 100) : "unknown", ok: false, error: "That capture couldn't be read. Capture it again.", permanent: true });
    }
  }
  try {
    const results = valid.length ? await processSyncBatch(staff, valid) : [];
    return json({ results: [...results, ...invalid] });
  } catch (err) {
    console.error("[field sync] batch failed:", err);
    return json({ error: "The server couldn't save these just now. They'll retry." }, 503);
  }
}
