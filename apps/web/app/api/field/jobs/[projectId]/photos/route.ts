import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { dayPhotoGroups } from "@/lib/field-server";
import { answer, json, notFound, projectIdSchema } from "../../../_lib/http";

/**
 * GET /api/field/jobs/<projectId>/photos?day=2 → the install photos taken
 * that day, with URLs, and the same photos grouped by runsheet step (the
 * end-of-day picker).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "install.work");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!projectIdSchema.safeParse(projectId).success) return notFound();
  if (!(await requireProjectAccess(projectId, { perm: "install.work" }))) return notFound();
  const day = z.coerce.number().int().min(1).max(30).safeParse(new URL(request.url).searchParams.get("day"));
  if (!day.success) return json({ error: "Which day?" }, 400);
  return answer(async () => dayPhotoGroups(projectId, staff, day.data));
}
