import { z } from "zod";
import { requestChanges } from "@/lib/proposal-server";
import { customerGate, json, respond } from "../../_shared";

/**
 * POST /api/proposals/<proposalId>/changes: the customer asks for changes
 * in their own words. The team hears through the outbox; the customer can
 * still accept this version while we revise it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ text: z.string().trim().min(3).max(2000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await customerGate(request, params, {
    scope: "proposal-respond",
    limit: 10,
    schema,
    staffMessage: "Change requests come from the customer. Note theirs on the project instead.",
  });
  if (!gate.ok) return gate.response;
  if (!gate.customerId) return json({ error: "Not found" }, 404);
  try {
    return respond(await requestChanges(gate.proposalId, gate.body.text, { customerId: gate.customerId }));
  } catch (err) {
    console.error("[proposals] changes failed:", err);
    return json({ error: "We couldn't send that just now. Please try again in a moment, or call us." }, 500);
  }
}
