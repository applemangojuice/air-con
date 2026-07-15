import { NextResponse } from "next/server";
import { classifyProperty, prefillFromIntel } from "@aircon/domain";
import { loadIntel } from "@/lib/intel-server";

/**
 * The public slice of a property's intelligence: enough to prefill the
 * funnel and describe the proposed install. Marketing state and audit
 * notes never leave the ops side.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9-]{4,80}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const intel = await loadIntel(id);
  if (!intel) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cls = classifyProperty(intel);
  return NextResponse.json({
    id: intel.id,
    addressLine: intel.address.line1,
    postcode: intel.address.postcode,
    prefill: prefillFromIntel(intel),
    archetypeName: cls.archetypeName ?? null,
    planningRisk: cls.planningRisk,
    confidence: cls.confidence,
  });
}
