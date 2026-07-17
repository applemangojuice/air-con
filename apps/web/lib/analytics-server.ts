import { getServiceClient } from "./supabase-server";

/**
 * Server-side reads for the ops analytics dashboard. Volume is low at this
 * stage, so we pull the recent event window and aggregate in JS rather than
 * pushing group-bys into Postgres — simpler, and easy to reshape as questions
 * change. Swap to SQL/RPC aggregation when the table gets big.
 */

export interface AnalyticsEventRow {
  created_at: string;
  visitor_id: string | null;
  session_id: string | null;
  type: string;
  path: string | null;
  referrer_host: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
}

export interface Count {
  key: string;
  count: number;
}

export interface AnalyticsSummary {
  configured: boolean;
  hasTable: boolean;
  error: string | null;
  windowDays: number;
  totalEvents: number;
  pageViews: number;
  uniqueVisitors: number;
  sessions: number;
  pageViews7d: number;
  uniqueVisitors7d: number;
  daily: { date: string; views: number; visitors: number }[];
  topPages: Count[];
  topReferrers: Count[];
  topSources: Count[];
  topCampaigns: Count[];
  devices: Count[];
  countries: Count[];
  cities: Count[];
  funnel: {
    quotePageViews: number;
    quoteStarts: number;
    quoteSubmits: number;
    quoteSaved: number;
    quoteFailed: number;
  };
}

function topN(counts: Map<string, number>, n: number): Count[] {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function analyticsSummary(windowDays = 30): Promise<AnalyticsSummary> {
  const empty: AnalyticsSummary = {
    configured: false,
    hasTable: false,
    error: null,
    windowDays,
    totalEvents: 0,
    pageViews: 0,
    uniqueVisitors: 0,
    sessions: 0,
    pageViews7d: 0,
    uniqueVisitors7d: 0,
    daily: [],
    topPages: [],
    topReferrers: [],
    topSources: [],
    topCampaigns: [],
    devices: [],
    countries: [],
    cities: [],
    funnel: { quotePageViews: 0, quoteStarts: 0, quoteSubmits: 0, quoteSaved: 0, quoteFailed: 0 },
  };

  const supabase = getServiceClient();
  if (!supabase) return empty;

  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
  const { data, error } = await supabase
    .from("analytics_events")
    .select(
      "created_at, visitor_id, session_id, type, path, referrer_host, utm_source, utm_campaign, country, region, city, device",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50000);

  if (error) {
    return { ...empty, configured: true, hasTable: false, error: error.message };
  }

  const rows = (data ?? []) as AnalyticsEventRow[];
  const sevenDaysAgo = Date.now() - 7 * 86400_000;

  const visitors = new Set<string>();
  const visitors7d = new Set<string>();
  const sessions = new Set<string>();
  const pages = new Map<string, number>();
  const referrers = new Map<string, number>();
  const sources = new Map<string, number>();
  const campaigns = new Map<string, number>();
  const devices = new Map<string, number>();
  const countries = new Map<string, number>();
  const cities = new Map<string, number>();
  const dailyViews = new Map<string, number>();
  const dailyVisitors = new Map<string, Set<string>>();

  let pageViews = 0;
  let pageViews7d = 0;
  const funnel = { quotePageViews: 0, quoteStarts: 0, quoteSubmits: 0, quoteSaved: 0, quoteFailed: 0 };

  for (const r of rows) {
    const ts = new Date(r.created_at).getTime();
    if (r.session_id) sessions.add(r.session_id);
    if (r.visitor_id) {
      visitors.add(r.visitor_id);
      if (ts >= sevenDaysAgo) visitors7d.add(r.visitor_id);
    }
    if (r.device) devices.set(r.device, (devices.get(r.device) ?? 0) + 1);
    if (r.country) countries.set(r.country, (countries.get(r.country) ?? 0) + 1);
    if (r.city) {
      const label = r.region ? `${r.city}, ${r.region}` : r.city;
      cities.set(label, (cities.get(label) ?? 0) + 1);
    }
    if (r.referrer_host) referrers.set(r.referrer_host, (referrers.get(r.referrer_host) ?? 0) + 1);
    if (r.utm_source) sources.set(r.utm_source, (sources.get(r.utm_source) ?? 0) + 1);
    if (r.utm_campaign) campaigns.set(r.utm_campaign, (campaigns.get(r.utm_campaign) ?? 0) + 1);

    if (r.type === "page_view") {
      pageViews++;
      if (ts >= sevenDaysAgo) pageViews7d++;
      const path = r.path ?? "(unknown)";
      pages.set(path, (pages.get(path) ?? 0) + 1);
      if (path === "/quote") funnel.quotePageViews++;
      const day = isoDay(new Date(r.created_at));
      dailyViews.set(day, (dailyViews.get(day) ?? 0) + 1);
      if (r.visitor_id) {
        const set = dailyVisitors.get(day) ?? new Set<string>();
        set.add(r.visitor_id);
        dailyVisitors.set(day, set);
      }
    } else if (r.type === "quote_start") {
      funnel.quoteStarts++;
    } else if (r.type === "quote_submit") {
      funnel.quoteSubmits++;
    } else if (r.type === "quote_save_failed") {
      funnel.quoteFailed++;
    }
  }
  funnel.quoteSaved = Math.max(0, funnel.quoteSubmits - funnel.quoteFailed);

  // A continuous 14-day strip, zero-filled, oldest → newest.
  const daily: { date: string; views: number; visitors: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = isoDay(new Date(Date.now() - i * 86400_000));
    daily.push({ date: day, views: dailyViews.get(day) ?? 0, visitors: dailyVisitors.get(day)?.size ?? 0 });
  }

  return {
    configured: true,
    hasTable: true,
    error: null,
    windowDays,
    totalEvents: rows.length,
    pageViews,
    uniqueVisitors: visitors.size,
    sessions: sessions.size,
    pageViews7d,
    uniqueVisitors7d: visitors7d.size,
    daily,
    topPages: topN(pages, 12),
    topReferrers: topN(referrers, 10),
    topSources: topN(sources, 10),
    topCampaigns: topN(campaigns, 10),
    devices: topN(devices, 5),
    countries: topN(countries, 10),
    cities: topN(cities, 10),
    funnel,
  };
}
