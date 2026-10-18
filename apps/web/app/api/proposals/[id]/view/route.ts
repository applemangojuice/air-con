import { z } from "zod";
import { recordView } from "@/lib/proposal-server";
import { customerGate, json, respond } from "../../_shared";

/**
 * POST /api/proposals/<proposalId>/view: the proposal page's beacon. Records
 * the customer's first view once; a staff preview is acknowledged and
 * ignored (it isn't the customer reading it).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({}).passthrough();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const gate = await customerGate(request, params, { scope: "proposal-view", limit: 30, schema });
  if (!gate.ok) return gate.response;
  if (!gate.customerId) return json({ ok: true, ignored: "staff" });
  try {
    return respond(await recordView(gate.proposalId, { customerId: gate.customerId }));
  } catch (err) {
    console.error("[proposals] view failed:", err);
    return json({ error: "Couldn't record the view" }, 500);
  }
}
