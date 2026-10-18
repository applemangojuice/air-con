import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireStaffApi } from "@/lib/auth/server";
import { confirmStaffUpload, startStaffUpload } from "@/lib/ops-core-server";
import * as staffRepo from "@/lib/repo/staff";

/**
 * POST /ops/staff/media: staff photos and certificate scans (admin only).
 * Staff media belongs to no project, so it has its own two-step upload:
 *
 *   { step: "start", staffId, purpose, fileName, contentType } → { mediaId, path, signedUrl }
 *   PUT the bytes to signedUrl
 *   { step: "confirm", staffId, mediaId, path, purpose }       → { mediaId, url }
 *
 * A confirmed photo becomes the person's photo at once; a certificate's id
 * goes back to the editor, which saves it with the qualification.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const schema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("start"),
    staffId: z.string().uuid(),
    purpose: z.enum(["photo", "evidence"]),
    fileName: z.string().min(1).max(200),
    contentType: z.string().min(1).max(100),
  }),
  z.object({
    step: z.literal("confirm"),
    staffId: z.string().uuid(),
    purpose: z.enum(["photo", "evidence"]),
    mediaId: z.string().uuid(),
    path: z.string().min(10).max(400),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  const admin = await requireStaffApi(request, "staff.edit");
  if (admin instanceof Response) return admin;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const input = parsed.data;
  const person = await staffRepo.get(input.staffId);
  if (!person) return json({ error: "Not found" }, 404);

  try {
    if (input.step === "start") {
      const started = await startStaffUpload(input);
      return "error" in started ? json({ error: started.error }, started.status) : json(started);
    }
    const confirmed = await confirmStaffUpload({ ...input, by: admin });
    if ("error" in confirmed) return json({ error: confirmed.error }, confirmed.status);
    if (input.purpose === "photo" && person.photoMediaId !== confirmed.item.id) {
      await staffRepo.update({ ...person, photoMediaId: confirmed.item.id }, admin);
      await audit({ actor: admin, action: "staff.photo", entity: "staff", entityId: person.id, detail: { mediaId: confirmed.item.id } });
      revalidatePath("/ops/staff");
      revalidatePath(`/ops/staff/${person.id}`);
    }
    return json({ mediaId: confirmed.item.id, url: confirmed.url });
  } catch (err) {
    console.error("[staff media] failed:", err);
    return json({ error: "The upload couldn't be recorded. Try again." }, 502);
  }
}
