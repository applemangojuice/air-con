import { TARGET_KEYS } from "@aircon/domain";
import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { setTarget } from "@/lib/field-server";
import { answer, json, notFound, projectIdSchema, readJson } from "../../../_lib/http";

/**
 * POST /api/field/jobs/<projectId>/targets { key, min?, max?, note? }
 * The tech lead sets (or confirms as record-only) one of the job's
 * manufacturer targets; readings already taken are judged against it.
 * Answers with what was applied (`applied`: the input, who, when), which
 * the screen applies to its own copy of the runsheet at once.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const bound = z.number().finite().min(0).max(1_000_000).optional();
const bodySchema = z.object({
  key: z.enum(TARGET_KEYS as [string, ...string[]]),
  min: bound,
  max: bound,
  note: z.string().max(500).optional(),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "install.review");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!projectIdSchema.safeParse(projectId).success) return notFound();
  if (!(await requireProjectAccess(projectId, { perm: "install.review" }))) return notFound();
  const body = bodySchema.safeParse(await readJson(request));
  if (!body.success) return json({ error: "Invalid target" }, 400);
  const b = body.data;
  return answer(async () => {
    const { applied } = await setTarget(projectId, staff, {
      key: b.key as (typeof TARGET_KEYS)[number],
      ...(b.min !== undefined ? { min: b.min } : {}),
      ...(b.max !== undefined ? { max: b.max } : {}),
      ...(b.note ? { note: b.note } : {}),
    });
    return { ok: true, applied };
  });
}
