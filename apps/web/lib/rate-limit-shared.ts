import type { SupabaseClient } from "@supabase/supabase-js";
import { clientKey, rateLimit, rateLimitIdentity, type RateLimitResult } from "./rate-limit";
import { dataBackend, getServiceClient } from "./supabase-server";

/**
 * Rate limits every serverless instance shares, for the scopes where a
 * per-instance count isn't enough: sign-in links (each one an email to
 * someone's inbox and a login_tokens row), customer portal links and the
 * break-glass password.
 *
 * Each hit is counted twice: in this instance's memory (rate-limit.ts, free,
 * and the brake that still works when the database doesn't) and, on Supabase,
 * in `rate_limits` through `rate_limit_hit` (migration 0012), one atomic
 * statement per hit, so Vercel's many warm instances and cold starts all see
 * the same count. Over either limit is over. Keys are hashed before they
 * leave the process: no email address or IP is stored.
 *
 * Fails open to the in-memory count when the shared one can't answer (0012
 * not run yet, the database unreachable), logged once, so a database blip
 * never locks everyone out of signing in.
 */

let warned = false;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The shared count's answer for one hit, or null when it can't give one. */
export async function sharedHit(client: SupabaseClient, key: string, limit: number, windowMs: number): Promise<RateLimitResult | null> {
  try {
    const { data, error } = await client.rpc("rate_limit_hit", {
      p_key: await sha256Hex(`dih-rate:${key}`),
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown; retry_after_seconds?: unknown } | null | undefined;
    if (!row || typeof row.allowed !== "boolean") throw new Error("no answer from rate_limit_hit");
    return row.allowed
      ? { ok: true, retryAfterSeconds: 0 }
      : { ok: false, retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || Math.ceil(windowMs / 1000)) };
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(
        "[rate-limit] the shared count isn't answering, so limits are per instance only (run supabase/migrations/0012_rate_limits.sql):",
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

/** One hit against `key`: over this instance's count or the shared one is over. */
export async function sharedRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const local = rateLimit(key, limit, windowMs);
  if (!local.ok) return local;
  const client = dataBackend() === "supabase" ? getServiceClient() : null;
  if (!client) return local;
  return (await sharedHit(client, key, limit, windowMs)) ?? local;
}

/** Every one of these limits at once (all are counted, so none can be dodged by tripping another first). */
export async function sharedRateLimits(checks: { key: string; limit: number; windowMs: number }[]): Promise<RateLimitResult> {
  const results = await Promise.all(checks.map((c) => sharedRateLimit(c.key, c.limit, c.windowMs)));
  const over = results.filter((r) => !r.ok);
  return over.length ? { ok: false, retryAfterSeconds: Math.max(...over.map((r) => r.retryAfterSeconds)) } : { ok: true, retryAfterSeconds: 0 };
}

/** enforceRateLimit's shared twin for a route handler: a 429 when over, null when it may proceed. */
export async function enforceSharedRateLimit(request: Request, scope: string, limit: number, windowMs: number): Promise<Response | null> {
  const { ok, retryAfterSeconds } = await sharedRateLimit(`${scope}:${rateLimitIdentity(clientKey(request))}`, limit, windowMs);
  if (ok) return null;
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSeconds) },
  });
}
