import { z } from "zod";
import { actResponse, portalJson, reportProblem, requirePortalCustomer } from "@/lib/portal-server";

/**
 * "Report a problem" from the hub:
 *
 *   POST /api/portal/<projectId>/problems  { title, detail, mediaIds }
 *
 * Creates a customer-visible fault issue (with the customer's own portal
 * uploads attached) and tells the team. Only the project's own customer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

const bodySchema = z.object({
  title: z.string().trim().min(3).max(120),
  detail: z.string().max(4000).default(""),
  mediaIds: z.array(z.string().uuid()).max(6).default([]),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { projectId } = await params;
  const actor = await requirePortalCustomer(request, projectId, "problems", 10, 60 * 60_000);
  if (actor instanceof Response) return actor;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return portalJson({ ok: false, error: "Give it a short title (at least a few words) so we know what's wrong." }, 400);
  }
  try {
    return actResponse(await reportProblem(projectId, actor, parsed.data));
  } catch (err) {
    console.error(`[portal] problem report on ${projectId} failed:`, err);
    return portalJson({ ok: false, error: "Something went wrong on our side. Please try again, or call us." }, 500);
  }
}
