import { LEARNING_PROMPTS } from "@aircon/domain";
import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { dayUpdatePreview, endDay, headerStateOf, saveLearnings, startDay } from "@/lib/field-server";
import { answer, json, notFound, projectIdSchema, readJson } from "../../../_lib/http";

/**
 * POST /api/field/jobs/<projectId>/day
 *   { action: "start", n, gps? }        start install day n (day 1 runs the ready-to-install gate)
 *   { action: "preview", n, text, photoCount }   the end-of-day email the customer would get
 *   { action: "end", n, summary, customerText, mediaIds, learnings, clockEntryId? }
 *
 * Gate actions: never queued on the phone, so the answer (or the blockers)
 * comes back straight away.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };
const n = z.number().int().min(1).max(30);
const promptIds = LEARNING_PROMPTS.map((p) => p.id) as [string, ...string[]];

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), n, gps: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional() }),
  z.object({ action: z.literal("preview"), n, text: z.string().max(2000), photoCount: z.number().int().min(0).max(4) }),
  z.object({
    action: z.literal("end"),
    n,
    summary: z.string().max(2000),
    customerText: z.string().max(2000),
    mediaIds: z.array(z.string().uuid()).max(4),
    learnings: z.array(z.object({ promptId: z.enum(promptIds), answer: z.string().max(2000) })).max(LEARNING_PROMPTS.length),
    clockEntryId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("learnings"),
    n,
    answers: z.array(z.object({ promptId: z.enum(promptIds), answer: z.string().max(2000) })).max(LEARNING_PROMPTS.length),
  }),
]);

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "install.work");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!projectIdSchema.safeParse(projectId).success) return notFound();
  if (!(await requireProjectAccess(projectId, { perm: "install.work" }))) return notFound();
  const body = bodySchema.safeParse(await readJson(request));
  if (!body.success) return json({ error: "Invalid request" }, 400);
  const b = body.data;
  if (b.action === "start") {
    return answer(async () => {
      const project = await startDay(projectId, staff, b.n, b.gps);
      return { ok: true, day: project.install.days.find((d) => d.n === b.n) ?? null, header: headerStateOf(project) };
    });
  }
  if (b.action === "preview") return answer(() => dayUpdatePreview(projectId, staff, b.n, b.text, b.photoCount));
  if (b.action === "learnings") return answer(() => saveLearnings(projectId, staff, b.n, b.answers));
  return answer(async () => {
    const result = await endDay(projectId, staff, b);
    return { ok: true, email: result.email, learningsSaved: result.learningsSaved, alreadyEnded: result.alreadyEnded, clockStopped: result.clockStopped, header: headerStateOf(result.project) };
  });
}
