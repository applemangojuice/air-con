import { z } from "zod";
import { registerMedia, signedMediaUrls, verifyUploadTicket } from "@/lib/media-server";
import { portalJson, requirePortalCustomer } from "@/lib/portal-server";

/**
 * Confirm a customer's photo upload once the bytes are in storage:
 *
 *   POST /api/portal/<projectId>/uploads/<mediaId>  { ticket }  → { item: { id, url } }
 *
 * The ticket must be one this project's customer started (customer source,
 * taken by them); everything recorded comes from it. Idempotent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; mediaId: string }> };

const bodySchema = z.object({ ticket: z.string().min(10).max(8192) });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { projectId, mediaId } = await params;
  const actor = await requirePortalCustomer(request, projectId, "uploads-confirm", 40, 60 * 60_000);
  if (actor instanceof Response) return actor;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return portalJson({ error: "That upload has expired. Please add the photo again." }, 400);
  const claims = await verifyUploadTicket(parsed.data.ticket);
  if (
    !claims ||
    claims.mediaId !== mediaId.toLowerCase() ||
    claims.projectId !== projectId.toLowerCase() ||
    claims.source !== "customer" ||
    claims.takenBy?.kind !== "customer" ||
    claims.takenBy.id !== actor.customerId
  ) {
    return portalJson({ error: "That upload has expired. Please add the photo again." }, 400);
  }

  try {
    const result = await registerMedia(parsed.data.ticket);
    if (!result.ok) return portalJson({ error: result.error }, result.status);
    const urls = await signedMediaUrls([result.item]);
    return portalJson({ item: { id: result.item.id, url: urls.get(result.item.id) ?? null } }, result.created ? 201 : 200);
  } catch (err) {
    console.error("[portal] customer upload confirm failed:", err);
    return portalJson({ error: "We couldn't save that photo. Please try again." }, 502);
  }
}
