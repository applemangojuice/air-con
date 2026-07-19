import { queryIntel, type IntelFilters } from "@/lib/intel-server";

/**
 * Mailing-list export for the current filter: one row per property with its
 * personalised landing URL (/a/<id>), ready for a mail-merge house. Sits
 * behind the same /ops basic-auth wall as the page (middleware matcher).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams;
  const filters: IntelFilters = {
    outcode: q.get("outcode") || undefined,
    band: q.get("band") || undefined,
    archetypeId: q.get("archetypeId") || undefined,
    leadStatus: q.get("leadStatus") || undefined,
    planningRisk: q.get("planningRisk") || undefined,
    auditedOnly: q.get("auditedOnly") === "1",
  };
  const rows = await queryIntel(filters);

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? url.origin).replace(/\/$/, "");
  const esc = (v: string | number | null) => {
    let s = String(v ?? "");
    // Formula-injection guard: address data can carry hostile prefixes and
    // this file is opened in Excel/Sheets — neutralise =+-@ prefixes.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "address,postcode,priority_band,priority_score,archetype,epc_rating,floor_area_m2,landing_url";
  const lines = rows.map((r) =>
    [
      esc(r.address_line),
      esc(r.postcode),
      esc(r.priority_band),
      esc(r.priority_score),
      esc(r.archetype_id),
      esc(r.epc_rating),
      esc(r.floor_area_m2),
      esc(`${base}/a/${r.id}`),
    ].join(","),
  );

  return new Response([header, ...lines].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="mailing-${filters.outcode ?? "all"}-${filters.band ?? "all"}.csv"`,
    },
  });
}
