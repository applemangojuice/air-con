import { getServiceClient } from "@/lib/supabase-server";
import { tabByKey } from "../tabs";

/**
 * CSV of quote requests for the selected tab — the owner's data, one click,
 * ready for a spreadsheet or a CRM import. Behind the same /ops basic-auth
 * wall as the page (middleware matcher).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tabKey = url.searchParams.get("tab") ?? "all";
  const tab = tabByKey(tabKey);
  // Unknown tab must NOT silently export everything.
  if (!tab) return new Response("Unknown tab", { status: 400 });
  const statuses = tab.statuses;

  const supabase = getServiceClient();
  if (!supabase) {
    return new Response("No database configured", { status: 503 });
  }

  // Paged fetch: the server-side Max Rows cap (default 1000) silently clips
  // a single query, and an export must be complete.
  const rows: Record<string, unknown>[] = [];
  const PAGE = 1000;
  const MAX_ROWS = 20000;
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let query = supabase
      .from("quote_requests")
      .select(
        "id, created_at, status, customer_name, email, phone, timeframe, postcode, address_line, total_gbp, room_count, confidence_score, confidence_band, source, utm_source, referrer, booked_at, follow_up_sent_at",
      )
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (statuses) query = query.in("status", statuses);
    const { data, error } = await query;
    if (error) return new Response(`Export failed: ${error.message}`, { status: 500 });
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  const data = rows as {
    [k: string]: string | number | null;
  }[];

  const esc = (v: string | number | null) => {
    let s = String(v ?? "");
    // Formula-injection guard: names/referrers come from the public funnel
    // and this file is opened in Excel/Sheets — neutralise =+-@ prefixes.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header =
    "created_at,status,name,email,phone,timeframe,postcode,address,total_gbp,rooms,confidence,confidence_band,source,utm_source,referrer,booked_at,followed_up_at,quote_url";
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? url.origin).replace(/\/$/, "");
  const lines = (data ?? []).map((r) =>
    [
      esc(r.created_at),
      esc(r.status),
      esc(r.customer_name),
      esc(r.email),
      esc(r.phone),
      esc(r.timeframe),
      esc(r.postcode),
      esc(r.address_line),
      esc(r.total_gbp),
      esc(r.room_count),
      esc(r.confidence_score),
      esc(r.confidence_band),
      esc(r.source),
      esc(r.utm_source),
      esc(r.referrer),
      esc(r.booked_at),
      esc(r.follow_up_sent_at),
      esc(`${base}/q/${r.id}`),
    ].join(","),
  );

  return new Response([header, ...lines].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="quotes-${tab.key}.csv"`,
    },
  });
}
