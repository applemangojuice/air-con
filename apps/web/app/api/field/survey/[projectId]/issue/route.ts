import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { SURVEY_ISSUE_TOPICS, raiseSurveyIssue, type SurveyIssueTopic } from "@/lib/survey-server";

/**
 * POST /api/field/survey/<projectId>/issue { topic: asbestos | flash-guard | structural, note? }
 *   → { issue: { id, number, title, status }, created }
 *
 * A stop-work issue from the survey: blocking for the install, owned by the
 * technical lead, with a team alert. Raising the same topic again while
 * it's open returns the open one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const schema = z.object({
  topic: z.enum(Object.keys(SURVEY_ISSUE_TOPICS) as [SurveyIssueTopic, ...SurveyIssueTopic[]]),
  note: z.string().max(2000).default(""),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "survey.conduct");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) return json({ error: "Not found" }, 404);
  const access = await requireProjectAccess(projectId, { perm: "survey.conduct" });
  if (!access || access.kind !== "staff") return json({ error: "Not found" }, 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  try {
    const result = await raiseSurveyIssue(projectId, parsed.data.topic, parsed.data.note, staff);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ issue: result.issue, created: result.created }, result.created ? 201 : 200);
  } catch (err) {
    console.error("[survey] issue failed:", err);
    return json({ error: "Couldn't raise the issue. Check your signal and try again, or call the office." }, 502);
  }
}
