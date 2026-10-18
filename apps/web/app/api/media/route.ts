import { z } from "zod";
import { PHOTO_TAGS } from "@aircon/domain";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { MEDIA_SOURCES, MediaError, canWriteMedia, createMediaUpload, listProjectMedia } from "@/lib/media-server";

/**
 * Project media (contract §F, F2's API; shared by survey, install and ops).
 *
 *   POST /api/media                 staff: start an upload → { mediaId, signedUrl, path, ticket }
 *                                   then PUT the bytes to signedUrl and confirm with
 *                                   POST /api/media/<mediaId> { ticket }
 *   GET  /api/media?projectId=…     staff on the job: every item; the project's customer:
 *                                   customer-visible items only. Each with a signed `url`.
 *
 * Every "no" about a project is a 404, never a hint that it exists.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const notFound = () => json({ error: "Not found" }, 404);

const createSchema = z.object({
  projectId: z.string().uuid(),
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  tag: z.enum(PHOTO_TAGS),
  roomId: z.string().max(64).optional(),
  caption: z.string().max(280).optional(),
  source: z.enum(MEDIA_SOURCES as [string, ...string[]]),
  customerVisible: z.boolean().optional(),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const staff = await requireStaffApi(request);
  if (staff instanceof Response) return staff;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const input = parsed.data;
  const source = input.source as (typeof MEDIA_SOURCES)[number];

  const access = await requireProjectAccess(input.projectId);
  if (!access || access.kind !== "staff") return notFound();
  if (!canWriteMedia(staff, source)) return json({ error: "You don't have permission to do that" }, 403);

  try {
    const upload = await createMediaUpload({
      ...input,
      source,
      takenBy: { kind: "staff", id: staff.id, name: staff.name },
    });
    return json(upload);
  } catch (err) {
    if (err instanceof MediaError) return json({ error: err.message }, err.status);
    console.error("[media] create upload failed:", err);
    return json({ error: "Upload unavailable" }, 502);
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  if (!z.string().uuid().safeParse(projectId).success) return notFound();

  const access = await requireProjectAccess(projectId, { allowCustomer: true });
  if (!access) return notFound();

  const tag = url.searchParams.get("tag");
  const roomId = url.searchParams.get("roomId");
  const customer = access.kind === "customer";
  try {
    const items = await listProjectMedia(projectId, {
      customerVisibleOnly: customer,
      ...(tag && (PHOTO_TAGS as readonly string[]).includes(tag) ? { tag: tag as (typeof PHOTO_TAGS)[number] } : {}),
      ...(roomId ? { roomId: roomId.slice(0, 64) } : {}),
    });
    // Customers see their photos and drawings, not our storage layout.
    const body = customer ? items.map(({ bucket: _b, storagePath: _p, ...rest }) => rest) : items;
    return json({ items: body });
  } catch (err) {
    console.error("[media] list failed:", err);
    return json({ error: "Couldn't load media" }, 502);
  }
}
