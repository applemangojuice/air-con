import { z } from "zod";
import { declineProposal } from "@/lib/proposal-server";
import { customerGate, json, respond } from "../../_shared";

/** POST /api/proposals/<proposalId>/decline: the customer says no thanks, with an optional reason. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().trim().max(1000).default("") });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await customerGate(request, params, {
    scope: "proposal-respond",
    limit: 10,
    schema,
    staffMessage: "Only the customer can decline their proposal.",
  });
  if (!gate.ok) return gate.response;
  if (!gate.customerId) return json({ error: "Not found" }, 404);
  try {
    return respond(await declineProposal(gate.proposalId, gate.body.reason, { customerId: gate.customerId }));
  } catch (err) {
    console.error("[proposals] decline failed:", err);
    return json({ error: "We couldn't send that just now. Please try again in a moment, or call us." }, 500);
  }
}
