import { can, pilotsCsv } from "@aircon/domain";
import { audit } from "@/lib/audit";
import { requireStaffApi } from "@/lib/auth/server";
import { loadPilotRows } from "@/lib/ops-core-server";
import { londonToday } from "@/lib/project-service";
import { getServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /ops/pilots/export: every pilot's metrics as CSV (the same numbers as
 * the dashboard, from the same function). It carries costs and margins, so
 * it needs the margin permission as well as the pilots one.
 */
export async function GET(request: Request): Promise<Response> {
  const staff = await requireStaffApi(request, "pilots.view");
  if (staff instanceof Response) return staff;
  if (!can(staff, "finance.view-margin")) return Response.json({ error: "You don't have permission to export costs and margins" }, { status: 403 });
  if (!getServiceClient()) return Response.json({ error: "No database connected" }, { status: 503 });
  try {
    const { rows } = await loadPilotRows();
    const csv = pilotsCsv(rows.map((r) => r.metrics));
    await audit({ actor: staff, action: "pilots.export", entity: "pilots", detail: { rows: rows.length } });
    return new Response(`﻿${csv}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="pilots-${londonToday()}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[pilots] export failed:", err);
    return Response.json({ error: "The export couldn't be built. Try again." }, { status: 502 });
  }
}
