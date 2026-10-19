import { NextResponse } from "next/server";
import { demoLoginAllowed } from "@/lib/auth/access";
import { healthReport } from "@/lib/health";

/**
 * Public health probe for uptime monitors. Deliberately leaks nothing: just
 * whether the database is configured and every table, column and bucket is
 * present. The detailed breakdown lives behind the staff sign-in at /ops/status.
 *
 *   200 "ok"       connected, schema complete
 *   503 "degraded" connected, but something's missing: data is being lost
 *   503 "demo"     production with no database: every lead is dropped
 *   200 "demo"     no database outside production, or a deliberate demo
 *                  deployment (ALLOW_DEMO_LOGIN=1), where that's expected
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await healthReport();
  const status = report.healthy ? "ok" : report.configured ? "degraded" : "demo";
  const demoExpected = process.env.NODE_ENV !== "production" || demoLoginAllowed(process.env);
  const httpStatus = report.healthy || (!report.configured && demoExpected) ? 200 : 503;
  return NextResponse.json(
    {
      status,
      configured: report.configured,
      reachable: report.reachable,
      healthy: report.healthy,
    },
    { status: httpStatus },
  );
}
