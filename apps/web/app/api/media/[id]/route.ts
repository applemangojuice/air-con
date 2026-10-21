import { z } from "zod";
import { PHOTO_TAGS } from "@aircon/domain";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { canEditMedia, canWriteMedia, registerMedia, signedMediaUrls, updateMedia, verifyUploadTicket } from "@/lib/media-server";
import * as mediaRepo from "@/lib/repo/media";

/**
 * One media item, staff only.
 *
 *   POST  /api/media/<id> { ticket }   confirm an upload: the file is in storage, record it
 *                                      (idempotent; everything comes from the signed ticket)
 *   PATCH /api/media/<id> { annotations?, expectedVersion?, tag?, caption?, customerVisible?, roomId? }
 *                                      a locked item refuses drawing, tag and room changes (409),
 *                                      and a stale drawing save is refused, not lost (409)
 *
 * Both answer with the item and a fresh signed `url`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const notFound = () => json({ error: "Not found" }, 404);

async function withUrl<T extends { id: string; bucket: string; storagePath: string }>(item: T) {
  const urls = await signedMediaUrls([item]);
  return { ...item, url: urls.get(item.id) ?? null };
}

const confirmSchema = z.object({ ticket: z.string().min(10).max(8192) });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request);
  if (staff instanceof Response) return staff;
  const { id } = await params;

  const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const claims = await verifyUploadTicket(parsed.data.ticket);
  if (!claims || claims.mediaId !== id.toLowerCase()) {
    return json({ error: "That upload has expired or isn't valid. Start the upload again." }, 400);
  }
  // Whoever confirms must still be on the job, with the right permission.
  const access = await requireProjectAccess(claims.projectId);
  if (!access || access.kind !== "staff") return notFound();
  if (!canWriteMedia(staff, claims.source)) return json({ error: "You don't have permission to do that" }, 403);

  try {
    const result = await registerMedia(parsed.data.ticket);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ item: await withUrl(result.item), created: result.created ?? false }, result.created ? 201 : 200);
  } catch (err) {
    console.error("[media] confirm failed:", err);
    return json({ error: "Couldn't record the upload" }, 502);
  }
}

const patchSchema = z
  .object({
    annotations: z.array(z.unknown()).max(500).optional(),
    expectedVersion: z.number().int().min(0).optional(),
    tag: z.enum(PHOTO_TAGS).optional(),
    caption: z.string().max(280).nullable().optional(),
    customerVisible: z.boolean().optional(),
    roomId: z.string().max(64).nullable().optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request);
  if (staff instanceof Response) return staff;
  const { id } = await params;

  const item = await mediaRepo.get(id);
  if (!item || !item.projectId) return notFound();
  const access = await requireProjectAccess(item.projectId);
  if (!access || access.kind !== "staff") return notFound();
  if (!canEditMedia(staff)) return json({ error: "You don't have permission to do that" }, 403);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);

  try {
    const result = await updateMedia(id, parsed.data);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ item: await withUrl(result.item) });
  } catch (err) {
    console.error("[media] update failed:", err);
    return json({ error: "Couldn't save the change" }, 502);
  }
}
