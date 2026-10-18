import { z } from "zod";
import { MediaError, createMediaUpload, normaliseContentType } from "@/lib/media-server";
import { portalJson, requirePortalCustomer } from "@/lib/portal-server";
import * as customersRepo from "@/lib/repo/customers";

/**
 * A customer's photo for a problem report (contract §G F1), the same
 * three-step upload as staff media, kept to what a customer needs:
 *
 *   POST /api/portal/<projectId>/uploads             { fileName, contentType, width?, height? }
 *        → { mediaId, signedUrl, ticket }  then PUT the bytes to signedUrl
 *   POST /api/portal/<projectId>/uploads/<mediaId>   { ticket }  → { item: { id, url } }
 *
 * Photos only, source "customer", visible to the customer, taken by them.
 * Everything that becomes the media row comes from the signed ticket.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/** What a phone's camera roll gives us. No video or documents from the portal. */
const CUSTOMER_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

const bodySchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const actor = await requirePortalCustomer(request, projectId, "uploads", 20, 60 * 60_000);
  if (actor instanceof Response) return actor;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return portalJson({ error: "That upload request wasn't quite right." }, 400);
  const contentType = normaliseContentType(parsed.data.contentType);
  if (!CUSTOMER_PHOTO_TYPES.includes(contentType)) {
    return portalJson({ error: "Photos only, please (JPEG, PNG, WebP or HEIC)." }, 415);
  }

  try {
    const customer = await customersRepo.get(actor.customerId);
    const upload = await createMediaUpload({
      projectId,
      fileName: parsed.data.fileName,
      contentType,
      tag: "other",
      caption: "Reported by the customer",
      source: "customer",
      takenBy: { kind: "customer", id: actor.customerId, ...(customer?.name ? { name: customer.name } : {}) },
      customerVisible: true,
      ...(parsed.data.width ? { width: parsed.data.width } : {}),
      ...(parsed.data.height ? { height: parsed.data.height } : {}),
    });
    return portalJson({ mediaId: upload.mediaId, signedUrl: upload.signedUrl, ticket: upload.ticket });
  } catch (err) {
    if (err instanceof MediaError) return portalJson({ error: err.message }, err.status);
    console.error("[portal] customer upload start failed:", err);
    return portalJson({ error: "Photo uploads aren't available just now. You can still send the report without one." }, 502);
  }
}
