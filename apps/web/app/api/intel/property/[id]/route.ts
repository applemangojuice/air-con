import { NextResponse } from "next/server";
import { classifyProperty, lookupNeeds, prefillFromIntel } from "@aircon/domain";
import { isSampleIntel, loadIntel } from "@/lib/intel-server";
import { enrichAndStore } from "@/lib/property-lookup";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * The public slice of a property's intelligence: enough to prefill the
 * funnel and describe the proposed install. Marketing state and audit
 * notes never leave the ops side.
 *
 * A home found by a live postcode lookup arrives with its address only; the
 * first time it's picked, its EPC certificate, postcode centre and planning
 * constraints are fetched and saved here.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit(request, "intel-property", 30, 60_000);
  if (limited) return limited;

  const { id } = await params;
  if (!/^[a-z0-9-]{4,80}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let intel = await loadIntel(id);
  if (!intel) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getServiceClient();
  // Made-up sample homes are never looked up: their postcodes are real places.
  if (db && lookupNeeds(intel).any && id !== "demo" && !isSampleIntel(intel)) intel = await enrichAndStore(db, intel);

  const cls = classifyProperty(intel);
  return NextResponse.json({
    id: intel.id,
    addressLine: intel.address.line1,
    postcode: intel.address.postcode,
    prefill: prefillFromIntel(intel),
    archetypeName: cls.archetypeName ?? null,
    planningRisk: cls.planningRisk,
    confidence: cls.confidence,
    // Where the prefill came from, for the "filled in from public records" note.
    epcLodgedAt: intel.epc?.lodgedAt ?? null,
  });
}
