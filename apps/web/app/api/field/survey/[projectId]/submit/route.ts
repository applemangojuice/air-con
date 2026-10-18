import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { submitSurvey } from "@/lib/survey-server";

/**
 * POST /api/field/survey/<projectId>/submit { data, expectedUpdatedAt }
 *   → 200 { submittedAt, minutes, proposalBy }
 *   → 409 { error, completeness? , blockers? } when it isn't finished or a gate refuses
 *   → 409 { error, conflict: true, current } when the draft changed elsewhere
 *
 * Saves the final copy, runs the survey-complete gate through dispatch
 * (survey-submitted), freezes the record and stops the survey clock.
 * Retrying after a dropped connection finishes the job.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

const schema = z.object({ data: z.unknown().optional(), expectedUpdatedAt: z.string().max(64).default("") });

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
    const result = await submitSurvey(projectId, parsed.data.data, parsed.data.expectedUpdatedAt, staff);
    if (result.ok) {
      return json({
        submittedAt: result.record.submittedAt ?? result.project.survey.submittedAt ?? null,
        minutes: result.record.minutes ?? null,
        recordId: result.record.id,
      });
    }
    if ("conflict" in result) return json({ error: result.error, conflict: true, current: result.current }, 409);
    return json(
      {
        error: result.error,
        ...(result.blockers ? { blockers: result.blockers } : {}),
        ...("completeness" in result && result.completeness ? { completeness: result.completeness } : {}),
      },
      result.status,
    );
  } catch (err) {
    console.error("[survey] submit failed:", err);
    return json({ error: "Couldn't submit. Nothing is lost: check your signal and try again." }, 502);
  }
}
