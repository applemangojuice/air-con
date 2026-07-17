import { NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Sink for first-party usage analytics. The browser beacons a single event
 * here (see lib/analytics-client.ts); we enrich it with edge geo + user agent
 * (never the raw IP) and write it with the service-role key. Unconfigured
 * Supabase → a quiet 200 so the beacon never errors in the client console.
 */

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
  meta: z.record(z.string(), z.unknown()).optional(),
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
  // Beacons arrive as text/plain; parse defensively either way.
  const raw = await request.text().catch(() => "");
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
    user_agent: h.get("user-agent"),
    meta: e.meta ?? null,
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
