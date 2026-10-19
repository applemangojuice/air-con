import { z } from "zod";
import { clientIp, clipUserAgent } from "@/components/proposal/model";
import { actResponse, decideVariation, portalJson, requirePortalCustomer } from "@/lib/portal-server";

/**
 * The customer's decision on a priced change (a variation issue):
 *
 *   POST /api/portal/<projectId>/variations/<issueId>
 *     { decision: "decline" }
 *     { decision: "accept", name: "<their full name>", agreed: true }
 *
 * A yes is an agreement to pay: it needs the typed name and the "I agree to
 * pay £X more" press, and is recorded with the wording, a fingerprint of the
 * change, the time, IP and browser; it creates the variation document and
 * emails the customer their copy. Decided once: a second answer is a 409.
 * Only the project's own customer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; issueId: string }> };

const bodySchema = z.object({
  decision: z.enum(["accept", "decline"]),
  name: z.string().max(120).optional(),
  agreed: z.boolean().optional(),
});

export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { projectId, issueId } = await params;
  const actor = await requirePortalCustomer(request, projectId, "variations", 20);
  if (actor instanceof Response) return actor;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(issueId).success) {
    return portalJson({ ok: false, error: "That request wasn't quite right. Please refresh and try again." }, 400);
  }
  try {
    const { decision, name, agreed } = parsed.data;
    const ip = clientIp(request.headers);
    const userAgent = clipUserAgent(request.headers.get("user-agent"));
    return actResponse(
      await decideVariation(projectId, actor, issueId, decision, {
        ...(name !== undefined ? { name } : {}),
        ...(agreed !== undefined ? { agreed } : {}),
        ...(ip ? { ip } : {}),
        ...(userAgent ? { userAgent } : {}),
      }),
    );
  } catch (err) {
    console.error(`[portal] variation ${issueId} failed:`, err);
    return portalJson({ ok: false, error: "Something went wrong on our side. Please try again in a moment." }, 500);
  }
}
