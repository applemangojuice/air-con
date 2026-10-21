import { NextResponse } from "next/server";
import { z } from "zod";
import { londonDayKey } from "@/lib/email-budget";
import { readTextCapped } from "@/lib/http-body";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sharedRateLimit } from "@/lib/rate-limit-shared";
import { getServiceClient } from "@/lib/supabase-server";
import { analyticsMeta } from "@/lib/analytics-meta";

/**
 * Sink for first-party usage analytics. The browser beacons a single event
 * here (see lib/analytics-client.ts); we enrich it with edge geo + user agent
 * (never the raw IP) and write it with the service-role key. Unconfigured
 * Supabase → a quiet 200 so the beacon never errors in the client console.
 */

/**
 * One beacon is one small event (a few hundred bytes). Anything bigger is
 * refused unread, so nobody can fill the database through this endpoint:
 * bounded rows, and a shared cap on how many a London day stores.
 */
const MAX_EVENT_BYTES = 4096;
const MAX_META_KEYS = 20;
const MAX_META_KEY = 40;
const MAX_META_STRING = 300;
const MAX_USER_AGENT = 300;
/** Events stored per London day, across every instance: far above the pilot site's traffic. */
const EVENTS_PER_DAY = 20_000;

const eventSchema = z.object({
  type: z.string().min(1).max(60),
  path: z.string().max(300).optional(),
  referrer: z.string().max(600).optional(),
  visitorId: z.string().max(80).optional(),
  sessionId: z.string().max(80).optional(),
  device: z.enum(["mobile", "tablet", "desktop"]).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  // What track() sends: a few flat facts (a step, a count). Never a blob, and never personal or price data (dropped below).
  meta: z
    .record(z.string().max(MAX_META_KEY), z.union([z.string().max(MAX_META_STRING), z.number().finite(), z.boolean(), z.null()]))
    .refine((m) => Object.keys(m).length <= MAX_META_KEYS, "too many facts")
    .optional(),
});

function hostOf(referrer?: string): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).host || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  // Generous — one IP can be a whole CGNAT carrier or office, and beacons
  // can't see a 429 (sendBeacon fires and forgets) — but still a flood brake.
  const limited = enforceRateLimit(request, "track", 600, 60_000);
  if (limited) return limited;

  // Beacons arrive as text/plain; parse defensively either way, and never read more than one event's worth.
  const raw = await readTextCapped(request, MAX_EVENT_BYTES);
  if (raw === null) return NextResponse.json({ ok: false }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    // Demo mode: acknowledge so the client never sees an error.
    return NextResponse.json({ ok: true, demo: true });
  }

  // A day's worth of events, then nothing more is stored until tomorrow (London).
  const day = await sharedRateLimit(`track-day:${londonDayKey(new Date())}`, EVENTS_PER_DAY, 26 * 3600_000);
  if (!day.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const e = parsed.data;
  const h = request.headers;
  const geo = {
    country: h.get("x-vercel-ip-country"),
    region: h.get("x-vercel-ip-country-region"),
    city: safeDecode(h.get("x-vercel-ip-city")),
  };

  const { error } = await supabase.from("analytics_events").insert({
    visitor_id: e.visitorId ?? null,
    session_id: e.sessionId ?? null,
    type: e.type,
    path: e.path ?? null,
    referrer: e.referrer ?? null,
    referrer_host: hostOf(e.referrer),
    utm_source: e.utmSource ?? null,
    utm_medium: e.utmMedium ?? null,
    utm_campaign: e.utmCampaign ?? null,
    utm_term: e.utmTerm ?? null,
    utm_content: e.utmContent ?? null,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    device: e.device ?? null,
    user_agent: h.get("user-agent")?.slice(0, MAX_USER_AGENT) || null,
    meta: analyticsMeta(e.meta),
  });

  if (error) {
    // A missing analytics_events table shouldn't spam logs on every page view,
    // but we do want it visible once so setup gaps surface.
    console.error("analytics insert failed:", error.message);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}

/** Vercel city header is percent-encoded ("New%20York"). */
function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
