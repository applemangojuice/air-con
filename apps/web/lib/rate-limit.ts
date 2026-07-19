/**
 * In-memory sliding-window rate limiter for the public API routes.
 *
 * Serverless honesty: each warm instance keeps its own window, so the
 * effective global limit is (limit × concurrent instances). That's fine for
 * what this is — a brake on abusive loops and script kiddies hammering the
 * funnel endpoints, not a billing-grade quota. If real abuse shows up, swap
 * the Map for Upstash/Redis behind the same interface.
 */

interface Window {
  /** Timestamps (ms) of accepted hits, newest last, pruned on every check. */
  hits: number[];
}

const windows = new Map<string, Window>();

/** Cap the map so a scan across many IPs can't balloon instance memory. */
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the oldest hit leaves the window (for Retry-After). */
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  let w = windows.get(key);
  if (!w) {
    // Bound memory by evicting oldest-inserted keys (Map preserves insertion
    // order) rather than clearing everything — a key-spraying attacker must
    // not be able to reset every active window, including their own.
    while (windows.size >= MAX_KEYS) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
    w = { hits: [] };
    windows.set(key, w);
  }

  w.hits = w.hits.filter((t) => t > cutoff);
  if (w.hits.length >= limit) {
    const oldest = w.hits[0] ?? now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  w.hits.push(now);
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Best client identity we can get behind Vercel's proxy. SAFE ON VERCEL
 * ONLY: Vercel overwrites x-forwarded-for with the true client IP. Behind an
 * append-style proxy (default nginx, generic LBs) the first hop is
 * client-forgeable, so if this app ever moves off Vercel, re-key this to the
 * proxy-verified header of that platform.
 */
export function clientKey(request: Request): string {
  const h = request.headers;
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return ip;
}

/**
 * Guard for a route handler: returns a 429 response when over the limit,
 * null when the request may proceed.
 *
 *   const limited = enforceRateLimit(request, "quotes", 10, 60_000);
 *   if (limited) return limited;
 */
export function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
): Response | null {
  const { ok, retryAfterSeconds } = rateLimit(`${scope}:${clientKey(request)}`, limit, windowMs);
  if (ok) return null;
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(retryAfterSeconds),
    },
  });
}
