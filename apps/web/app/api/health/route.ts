import { NextResponse } from "next/server";
import { healthReport } from "@/lib/health";

/**
 * Public health probe for uptime monitors. Deliberately leaks nothing: just
 * whether the database is configured and every table/bucket is present. The
 * detailed, per-table breakdown lives behind the ops password at /ops/status.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await healthReport();
  return NextResponse.json(
    {
      status: report.healthy ? "ok" : report.configured ? "degraded" : "demo",
      configured: report.configured,
      reachable: report.reachable,
      healthy: report.healthy,
    },
    { status: report.healthy || !report.configured ? 200 : 503 },
  );
}
