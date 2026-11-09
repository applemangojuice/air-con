import { NextResponse } from "next/server";
import type { PropertyIntel } from "@aircon/domain";
import { requireStaffApi } from "@/lib/auth/server";
import { slimIntel } from "@/lib/intel-fields";
import { denormaliseIntel } from "@/lib/intel-server";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Space housekeeping for the property book, from the Data preview page
 * (/ops/intel/data). Admins only.
 *
 *  - { action: "slim", after?: id }: the next 500 homes after `after` (by id)
 *    lose the EPC details nothing uses, empty values and the long age-band
 *    prefix. Returns `next` to call again with, or null when done.
 *  - { action: "clear-notes" }: deletes the bulk import's history notes
 *    (source epc-import). Audits, installs and other history stay.
 *
 * Postgres keeps the old copies' space until the table is compacted
 * (VACUUM FULL), so the page gives that command after.
 */

export const maxDuration = 60;
const PAGE = 500;
const UPSERT_CHUNK = 250;

export async function POST(request: Request) {
  const staff = await requireStaffApi(request, "settings.edit");
  if (staff instanceof Response) return staff;
  const supabase = getServiceClient();
  if (!supabase) return NextResponse.json({ error: "No database is connected." }, { status: 503 });

  let body: { action?: unknown; after?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request wasn't readable." }, { status: 400 });
  }

  if (body.action === "clear-notes") {
    const { error, count } = await supabase.from("property_assessments").delete({ count: "exact" }).eq("source", "epc-import");
    if (error) return NextResponse.json({ error: `Couldn't remove the notes: ${error.message}` }, { status: 502 });
    return NextResponse.json({ removed: count ?? 0 });
  }

  if (body.action !== "slim") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const after = typeof body.after === "string" ? body.after : "";

  let query = supabase.from("properties").select("id, intel").order("id").limit(PAGE);
  if (after) query = query.gt("id", after);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: `Couldn't read homes: ${error.message}` }, { status: 502 });
  const rows = (data ?? []) as { id: string; intel: PropertyIntel }[];

  const changed = rows
    .map((r) => ({ id: r.id, ...slimIntel(r.intel) }))
    .filter((r) => r.changed)
    .map((r) => ({ id: r.id, ...denormaliseIntel({ ...r.intel, id: r.id }) }));
  for (let i = 0; i < changed.length; i += UPSERT_CHUNK) {
    const { error: saveError } = await supabase.from("properties").upsert(changed.slice(i, i + UPSERT_CHUNK));
    if (saveError) return NextResponse.json({ error: `Saving failed: ${saveError.message}` }, { status: 502 });
  }

  return NextResponse.json({
    scanned: rows.length,
    changed: changed.length,
    next: rows.length === PAGE ? rows[rows.length - 1].id : null,
  });
}
