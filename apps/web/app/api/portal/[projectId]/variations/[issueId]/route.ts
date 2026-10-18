import { z } from "zod";
import { actResponse, decideVariation, portalJson, requirePortalCustomer } from "@/lib/portal-server";

/**
 * The customer's decision on a priced change (a variation issue):
 *
 *   POST /api/portal/<projectId>/variations/<issueId>  { decision: "accept" | "decline" }
 *
 * Records variation.status, decidedAt and decidedBy (the customer's name)
 * with a history line, tells the team, and nothing else. Decided once:
 * a second answer is a 409. Only the project's own customer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; issueId: string }> };

const bodySchema = z.object({ decision: z.enum(["accept", "decline"]) });

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { projectId, issueId } = await params;
  const actor = await requirePortalCustomer(request, projectId, "variations", 20);
  if (actor instanceof Response) return actor;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(issueId).success) {
    return portalJson({ ok: false, error: "That request wasn't quite right. Please refresh and try again." }, 400);
  }
  try {
    return actResponse(await decideVariation(projectId, actor, issueId, parsed.data.decision));
  } catch (err) {
    console.error(`[portal] variation ${issueId} failed:`, err);
    return portalJson({ ok: false, error: "Something went wrong on our side. Please try again in a moment." }, 500);
  }
}
