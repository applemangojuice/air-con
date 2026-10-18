import { z } from "zod";
import { surveyCompleteness } from "@aircon/domain";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { loadDraft, saveDraft } from "@/lib/survey-server";

/**
 * The draft measured survey for one project (F2). Staff with
 * survey.conduct who can open the project; anyone else gets a 404.
 *
 *   GET /api/field/survey/<projectId>
 *       → { record, updatedAt, completeness } (record null before the survey starts)
 *   PUT /api/field/survey/<projectId> { data: MeasuredSurvey, expectedUpdatedAt }
 *       → 200 { updatedAt, completeness }
 *       → 409 { error, conflict: true, current: { record, updatedAt } } when the row
 *         changed since `expectedUpdatedAt` (the phone keeps its copy and decides)
 *       → 400 when the survey doesn't validate
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const notFound = () => json({ error: "Not found" }, 404);

/** Signed in with survey.conduct, and on this project. */
async function guard(request: Request, projectId: string) {
  const staff = await requireStaffApi(request, "survey.conduct");
  if (staff instanceof Response) return staff;
  if (!z.string().uuid().safeParse(projectId).success) return notFound();
  const access = await requireProjectAccess(projectId, { perm: "survey.conduct" });
  if (!access || access.kind !== "staff") return notFound();
  return staff;
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const staff = await guard(request, projectId);
  if (staff instanceof Response) return staff;
  try {
    const draft = await loadDraft(projectId);
    if (!draft) return json({ record: null, updatedAt: null, completeness: null });
    return json({ record: draft.record, updatedAt: draft.updatedAt, completeness: surveyCompleteness(draft.record.data) });
  } catch (err) {
    console.error("[survey] load failed:", err);
    return json({ error: "Couldn't load the survey" }, 502);
  }
}

const putSchema = z.object({
  data: z.unknown(),
  expectedUpdatedAt: z.string().min(1).max(64),
});

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const staff = await guard(request, projectId);
  if (staff instanceof Response) return staff;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  try {
    const result = await saveDraft(projectId, parsed.data.data, parsed.data.expectedUpdatedAt, staff);
    if (result.ok) return json({ updatedAt: result.updatedAt, completeness: result.completeness });
    if ("conflict" in result) return json({ error: result.error, conflict: true, current: result.current }, 409);
    return json({ error: result.error }, result.status);
  } catch (err) {
    console.error("[survey] save failed:", err);
    return json({ error: "Couldn't save the survey. It's kept on this phone; we'll try again." }, 502);
  }
}
