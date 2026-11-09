import { NextResponse } from "next/server";
import type { PropertyIntel } from "@aircon/domain";
import { requireStaffApi } from "@/lib/auth/server";
import {
  EPC_BATCH_MAX,
  EPC_FIELD_NAMES,
  epcCandidate,
  mergeEpc,
  newestPerHome,
  parseOutcodes,
  type EpcRow,
} from "@/lib/epc-import";
import { denormaliseIntel } from "@/lib/intel-server";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * One batch of EPC certificates from the upload page (/ops/intel/import).
 * The browser has already read the government's files and kept only the
 * outcodes asked for; this saves them with the importer's rules: the newest
 * certificate per home wins, and what we know about a home survives.
 * Saving goes through the app's own scoring, so no recompute is needed after.
 */

export const maxDuration = 60;

/** Keys per `in (…)`: each one is in the request URL, which the API gateway caps. */
const IN_CHUNK = 100;
const UPSERT_CHUNK = 200;

function cleanRows(input: unknown): EpcRow[] | null {
  if (!Array.isArray(input) || input.length > EPC_BATCH_MAX) return null;
  const rows: EpcRow[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const row: EpcRow = {};
    for (const field of EPC_FIELD_NAMES) {
      const v = (raw as Record<string, unknown>)[field];
      if (typeof v === "string" && v.trim()) row[field] = v.trim().slice(0, 500);
    }
    rows.push(row);
  }
  return rows;
}

export async function POST(request: Request) {
  const staff = await requireStaffApi(request, "settings.edit");
  if (staff instanceof Response) return staff;

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "No database is connected, so there's nowhere to save the homes." }, { status: 503 });
  }

  let body: { rows?: unknown; outcodes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That batch wasn't readable." }, { status: 400 });
  }
  const rows = cleanRows(body.rows);
  if (!rows) return NextResponse.json({ error: `Send up to ${EPC_BATCH_MAX} rows at a time.` }, { status: 400 });
  const outcodes = typeof body.outcodes === "string" ? parseOutcodes(body.outcodes) : [];

  const candidates = newestPerHome(
    rows.map((r) => epcCandidate(r, outcodes)).filter((c): c is NonNullable<typeof c> => c !== null),
  );
  const skipped = rows.length - candidates.length;
  if (candidates.length === 0) return NextResponse.json({ saved: 0, older: 0, skipped });

  // What we already hold for these homes: by id (UPRN), then by address.
  const byId = new Map<string, { id: string; intel: PropertyIntel }>();
  const byKey = new Map<string, { id: string; intel: PropertyIntel }>();
  const ids = [...new Set(candidates.map((c) => c.intel.id))];
  const keys = [...new Set(candidates.map((c) => c.key))];
  try {
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await supabase.from("properties").select("id, intel").in("id", ids.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { id: string; intel: PropertyIntel }[]) byId.set(r.id, r);
    }
    for (let i = 0; i < keys.length; i += IN_CHUNK) {
      const { data, error } = await supabase
        .from("properties")
        .select("id, address_key, intel")
        .in("address_key", keys.slice(i, i + IN_CHUNK));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as { id: string; address_key: string; intel: PropertyIntel }[]) byKey.set(r.address_key, r);
    }
  } catch (err) {
    console.error("EPC import: reading existing homes failed:", err);
    return NextResponse.json({ error: "Couldn't read the homes already saved. Try again in a minute." }, { status: 502 });
  }

  let older = 0;
  const merged = new Map<string, PropertyIntel>();
  for (const c of candidates) {
    const intel = mergeEpc(c, byId.get(c.intel.id) ?? byKey.get(c.key));
    if (!intel) {
      older++;
      continue;
    }
    const prev = merged.get(intel.id);
    if (!prev || (intel.epc?.lodgedAt ?? "") >= (prev.epc?.lodgedAt ?? "")) merged.set(intel.id, intel);
  }

  const toSave = [...merged.values()].map((intel) => ({ id: intel.id, ...denormaliseIntel(intel) }));
  let saved = 0;
  for (let i = 0; i < toSave.length; i += UPSERT_CHUNK) {
    const chunk = toSave.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase.from("properties").upsert(chunk);
    if (error) {
      console.error("EPC import: save failed:", error.message);
      return NextResponse.json({ error: `Saving failed after ${saved} homes: ${error.message}`, saved, older, skipped }, { status: 502 });
    }
    // The history log gets a short note per certificate, not a second copy of the record:
    // a bulk load can be hundreds of thousands of homes, and the database plan's space is finite.
    const { error: logError } = await supabase.from("property_assessments").insert(
      chunk.map((r) => ({
        property_id: r.id,
        source: "epc-import",
        assessment: { via: "bulk-upload", lodgedAt: r.intel.epc?.lodgedAt ?? null, currentRating: r.intel.epc?.currentRating ?? null },
      })),
    );
    if (logError) console.warn("EPC import: assessment log failed:", logError.message);
    saved += chunk.length;
  }

  return NextResponse.json({ saved, older, skipped });
}
