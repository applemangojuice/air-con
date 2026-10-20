import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { reviewException } from "@/lib/field-server";
import { answer, json, notFound, projectIdSchema, readJson } from "../../../_lib/http";

/**
 * POST /api/field/jobs/<projectId>/exceptions { specId, evidenceId?, resolution, reason }
 * The tech lead accepts an out-of-window reading (with a reason) or asks for it again.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const bodySchema = z.object({
  specId: z.string().min(1).max(160),
  evidenceId: z.string().min(1).max(100).optional(),
  resolution: z.enum(["accepted", "recapture-required"]),
  reason: z.string().trim().min(3).max(1000),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "install.review");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!projectIdSchema.safeParse(projectId).success) return notFound();
  if (!(await requireProjectAccess(projectId, { perm: "install.review" }))) return notFound();
  const body = bodySchema.safeParse(await readJson(request));
  if (!body.success) return json({ error: "Give the reason: it goes on the record." }, 400);
  return answer(async () => {
    const { review } = await reviewException(projectId, staff, body.data);
    return { ok: true, review };
  });
}
