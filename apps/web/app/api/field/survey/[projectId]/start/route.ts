import { z } from "zod";
import { surveyCompleteness } from "@aircon/domain";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { startSurvey } from "@/lib/survey-server";

/**
 * POST /api/field/survey/<projectId>/start → { record, updatedAt, completeness, created }
 *
 * Starts the visit (survey-started on the project, which the customer
 * sees), creates the draft from the customer's own survey and starts the
 * survey clock. Idempotent: pressing it again resumes the draft.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "survey.conduct");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) return json({ error: "Not found" }, 404);
  const access = await requireProjectAccess(projectId, { perm: "survey.conduct" });
  if (!access || access.kind !== "staff") return json({ error: "Not found" }, 404);
  try {
    const result = await startSurvey(projectId, staff);
    if (!result.ok) return json({ error: result.error, ...(result.blockers ? { blockers: result.blockers } : {}) }, result.status);
    const { record, updatedAt } = result.draft;
    return json({ record, updatedAt, completeness: surveyCompleteness(record.data), created: result.created }, result.created ? 201 : 200);
  } catch (err) {
    console.error("[survey] start failed:", err);
    return json({ error: "Couldn't start the survey. Check your signal and try again." }, 502);
  }
}
