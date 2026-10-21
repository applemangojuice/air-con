import { z } from "zod";
import { clientIp, clipUserAgent } from "@/components/proposal/model";
import { acceptProposal } from "@/lib/proposal-server";
import { customerGate, json, respond } from "../../_shared";

/**
 * POST /api/proposals/<proposalId>/accept: the customer accepts one option
 * (order with obligation to pay). Customers only, on their own project;
 * staff get a 403 (we never accept on someone's behalf). The server builds
 * the acceptance record (time, IP, user agent, the wording versions shown,
 * the hash of the proposal they saw) and checks it before anything is
 * written. Safe to retry: a repeat answers with the acceptance on file.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  optionId: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  earlyStartRequested: z.boolean(),
  acknowledgedCancellationInfo: z.boolean(),
  acknowledgedLossOfRight: z.boolean(),
  documentHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await customerGate(request, params, {
    scope: "proposal-accept",
    limit: 10,
    schema,
    staffMessage: "Only the customer can accept their proposal. Staff can preview it, but never accept it for them.",
  });
  if (!gate.ok) return gate.response;
  if (!gate.customerId) return json({ error: "Not found" }, 404);
  try {
    const ip = clientIp(request.headers);
    const userAgent = clipUserAgent(request.headers.get("user-agent"));
    return respond(
      await acceptProposal(gate.proposalId, gate.body, { customerId: gate.customerId }, { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) }),
    );
  } catch (err) {
    console.error("[proposals] accept failed:", err);
    return json({ error: "We couldn't record your acceptance just now. Nothing has been accepted yet: please try again in a moment." }, 500);
  }
}
