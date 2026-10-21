import { requireStaffApi } from "@/lib/auth/server";
import { exportCatalogueCsv } from "@/lib/catalogue-server";
import { londonToday } from "@/lib/project-service";

/**
 * GET /ops/catalogue/export: the whole catalogue as CSV, buy costs
 * included, so only staff who may see margins can download it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const staff = await requireStaffApi(request, "finance.view-margin");
  if (staff instanceof Response) return staff;
  try {
    const csv = await exportCatalogueCsv();
    return new Response(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="catalogue-${londonToday()}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[catalogue] export failed:", err);
    return Response.json({ error: "The catalogue couldn't be exported just now." }, { status: 500 });
  }
}
