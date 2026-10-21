import { z } from "zod";
import { requireProjectAccess, requireStaffApi } from "@/lib/auth/server";
import { loadProject } from "@/lib/project-service";
import { MAX_ETA_MINUTES, onMyWayPreview, sendOnMyWay } from "@/lib/survey-server";

/**
 * The surveyor's "on my way" text.
 *
 *   GET  /api/field/survey/<projectId>/on-my-way?eta=20 → { preview, to }
 *        the exact text the customer would get, written by the template
 *   POST /api/field/survey/<projectId>/on-my-way { etaMinutes }
 *        → { etaMinutes, at, text: { state: sent | demo | queued | failed | not-sent, … }, smsMode }
 *        records surveyor-on-my-way (the outbox sends the SMS) and says honestly what happened
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const eta = z.coerce.number().int().min(1).max(MAX_ETA_MINUTES);

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "survey.conduct");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) return json({ error: "Not found" }, 404);
  const access = await requireProjectAccess(projectId, { perm: "survey.conduct" });
  if (!access || access.kind !== "staff") return json({ error: "Not found" }, 404);
  const minutes = eta.safeParse(new URL(request.url).searchParams.get("eta"));
  if (!minutes.success) return json({ error: `Pick an ETA between 1 and ${MAX_ETA_MINUTES} minutes.` }, 400);
  try {
    const project = await loadProject(projectId);
    if (!project) return json({ error: "Not found" }, 404);
    const preview = await onMyWayPreview(project, minutes.data, staff.name);
    return json({ preview, to: project.customer.phone ?? null });
  } catch (err) {
    console.error("[survey] on-my-way preview failed:", err);
    return json({ error: "Couldn't build the preview" }, 502);
  }
}

const postSchema = z.object({ etaMinutes: eta });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const staff = await requireStaffApi(request, "survey.conduct");
  if (staff instanceof Response) return staff;
  const { projectId } = await params;
  if (!z.string().uuid().safeParse(projectId).success) return json({ error: "Not found" }, 404);
  const access = await requireProjectAccess(projectId, { perm: "survey.conduct" });
  if (!access || access.kind !== "staff") return json({ error: "Not found" }, 404);
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: `Pick an ETA between 1 and ${MAX_ETA_MINUTES} minutes.` }, 400);
  try {
    const result = await sendOnMyWay(projectId, parsed.data.etaMinutes, staff);
    if (!result.ok) return json({ error: result.error }, result.status);
    const { ok: _ok, ...body } = result;
    return json(body);
  } catch (err) {
    console.error("[survey] on-my-way failed:", err);
    return json({ error: "Couldn't send that. Check your signal and try again." }, 502);
  }
}
