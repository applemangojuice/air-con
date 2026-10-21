import { z } from "zod";
import { actResponse, customerAct, portalJson, requirePortalCustomer } from "@/lib/portal-server";

/**
 * The customer's own changes on their hub, one request each:
 *
 *   POST /api/portal/<projectId>/actions  { kind: "book-survey", scheduledFor, mode, documentsConsent }
 *                                         { kind: "reschedule-survey", scheduledFor }
 *                                         { kind: "documents-consent" }
 *                                         { kind: "install-dates", dates }
 *                                         { kind: "prep", itemId, done }
 *                                         { kind: "feedback", score, comments? }
 *                                         { kind: "early-start" }
 *                                         { kind: "follow-ups", optedOut }
 *
 * Only the project's signed-in customer (404 otherwise, 403 for staff).
 * Slots and blocks are re-checked against what we'd offer now; the reducer
 * runs its own rules on top and its refusal comes back as `error`.
 * Variations and problem reports have their own routes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const slot = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("book-survey"), scheduledFor: slot, mode: z.enum(["in-person", "video"]), documentsConsent: z.boolean() }),
  z.object({ kind: z.literal("reschedule-survey"), scheduledFor: slot }),
  z.object({ kind: z.literal("documents-consent") }),
  z.object({ kind: z.literal("install-dates"), dates: z.array(isoDate).min(1).max(10) }),
  z.object({ kind: z.literal("prep"), itemId: z.string().min(1).max(60), done: z.boolean() }),
  z.object({ kind: z.literal("feedback"), score: z.number().int().min(0).max(10), comments: z.string().max(2000).optional() }),
  z.object({ kind: z.literal("early-start") }),
  z.object({ kind: z.literal("follow-ups"), optedOut: z.boolean() }),
]);

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const actor = await requirePortalCustomer(request, projectId, "actions", 60);
  if (actor instanceof Response) return actor;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return portalJson({ ok: false, error: "That request wasn't quite right. Please refresh and try again." }, 400);

  try {
    return actResponse(await customerAct(projectId, actor, parsed.data));
  } catch (err) {
    console.error(`[portal] ${parsed.data.kind} on ${projectId} failed:`, err);
    return portalJson({ ok: false, error: "Something went wrong on our side. Please try again in a moment." }, 500);
  }
}
