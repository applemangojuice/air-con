/**
 * Browser-side analytics: cookieless, first-party, tiny.
 *
 * A random visitor id lives in localStorage (persists across visits) and a
 * session id in sessionStorage (one per visit). First-touch acquisition (the
 * referrer + any UTM tags on the landing URL) is captured once and reused for
 * the whole session, so a booking can be traced back to the campaign that
 * produced it. Nothing here is personal data; there are no third-party
 * trackers and no cookies, so no banner is owed.
 *
 * Every call to `track()` fires a `navigator.sendBeacon` to /api/track, which
 * degrades to a keepalive fetch and, failing that, silently no-ops. Analytics
 * must never break the page.
 */

const VISITOR_KEY = "aircon.vid";
const SESSION_KEY = "aircon.sid";
const ATTRIBUTION_KEY = "aircon.attribution";

export interface Attribution {
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  landingPath?: string;
  firstSeenAt?: string;
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

function fromStore(store: Storage, key: string): string {
  let id = "";
  try {
    id = store.getItem(key) ?? "";
    if (!id) {
      id = randomId();
      store.setItem(key, id);
    }
  } catch {
    // private mode / storage disabled: fall back to an ephemeral id
    id = randomId();
  }
  return id;
}

export function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  return fromStore(window.localStorage, VISITOR_KEY);
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  return fromStore(window.sessionStorage, SESSION_KEY);
}

/** Captures first-touch acquisition exactly once, then returns it every time. */
export function getAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const existing = window.localStorage.getItem(ATTRIBUTION_KEY);
    if (existing) return JSON.parse(existing) as Attribution;
  } catch {
    /* fall through and recompute */
  }

  const params = new URLSearchParams(window.location.search);
  const attribution: Attribution = {
    referrer: document.referrer || undefined,
    utmSource: params.get("utm_source") ?? undefined,
    utmMedium: params.get("utm_medium") ?? undefined,
    utmCampaign: params.get("utm_campaign") ?? undefined,
    utmTerm: params.get("utm_term") ?? undefined,
    utmContent: params.get("utm_content") ?? undefined,
    landingPath: window.location.pathname,
    firstSeenAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution));
  } catch {
    /* best effort */
  }
  return attribution;
}

function deviceClass(): "mobile" | "tablet" | "desktop" {
  const w = window.innerWidth || 1024;
  if (w < 768) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

export interface TrackEvent {
  type: string;
  path: string;
  referrer?: string;
  visitorId: string;
  sessionId: string;
  device: "mobile" | "tablet" | "desktop";
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  meta?: Record<string, unknown>;
}

/** Fire-and-forget: records a usage event. Never throws. */
export function track(type: string, meta?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    const attribution = getAttribution();
    const event: TrackEvent = {
      type,
      path: window.location.pathname,
      referrer: document.referrer || undefined,
      visitorId: getVisitorId(),
      sessionId: getSessionId(),
      device: deviceClass(),
      utmSource: attribution.utmSource,
      utmMedium: attribution.utmMedium,
      utmCampaign: attribution.utmCampaign,
      utmTerm: attribution.utmTerm,
      utmContent: attribution.utmContent,
      meta,
    };
    const body = JSON.stringify(event);

    // sendBeacon survives the page unloading (e.g. clicking straight through
    // the funnel); fetch keepalive is the fallback when it's unavailable.
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon("/api/track", body);
      if (ok) return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // analytics is never allowed to break the page
  }
}
