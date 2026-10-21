import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sessionSecretUsable } from "./auth/session.ts";
import { createLocalClient, defaultDataDir, type LocalBackendKind } from "./db/local-client.ts";
import { nulSafe } from "./db/no-nul.ts";
import { realEnv } from "./env-placeholders.ts";

export const PHOTO_BUCKET = "survey-photos";
export const VIDEO_BUCKET = "survey-videos";
/** Private bucket for all staff and field media: photos, signatures, documents. */
export const MEDIA_BUCKET = "project-media";

export type DataBackend = "supabase" | "file" | "memory" | "none";

/**
 * Which data backend this process uses (contract §B):
 *   1. Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set;
 *   2. else the local backend when DATA_BACKEND is "file" or "memory", or
 *      outside production ("file" by default in dev);
 *   3. else "none": legacy demo mode, nothing persists.
 * DATA_BACKEND=none forces demo mode in dev, to check the public demo pages.
 */
export function dataBackend(): DataBackend {
  // The .env.example placeholders (YOUR-PROJECT.supabase.co, your-service-role-key) aren't a database.
  if (realEnv(process.env, "SUPABASE_URL") && realEnv(process.env, "SUPABASE_SERVICE_ROLE_KEY")) return "supabase";
  const choice = process.env.DATA_BACKEND;
  if (choice === "file" || choice === "memory") return choice;
  if (choice === "none") return "none";
  return process.env.NODE_ENV !== "production" ? "file" : "none";
}

/** Local clients live on globalThis so dev reloads and duplicated modules share one store. */
const LOCAL_CLIENTS = Symbol.for("aircon.local-db.clients");

function localClient(kind: LocalBackendKind): SupabaseClient {
  const g = globalThis as unknown as Record<symbol, Map<string, SupabaseClient> | undefined>;
  const cache = (g[LOCAL_CLIENTS] ??= new Map());
  const dataDir = kind === "file" ? defaultDataDir() : undefined;
  const key = `${kind}:${dataDir ?? ""}`;
  let client = cache.get(key);
  if (!client) {
    // The same rule as sessions: in production a short secret counts as unset.
    const usable = sessionSecretUsable(process.env);
    if (!usable) {
      console.warn(
        process.env.NODE_ENV === "production"
          ? "[local-db] SESSION_SECRET not set (or under 32 characters): local file uploads and signed URLs are disabled."
          : "[local-db] SESSION_SECRET not set: signing local file URLs with the dev fallback secret.",
      );
    }
    client = nulSafe(
      createLocalClient({
        backend: kind,
        dataDir,
        secret: usable ? process.env.SESSION_SECRET : undefined,
        buckets: [PHOTO_BUCKET, VIDEO_BUCKET, MEDIA_BUCKET],
      }),
    );
    cache.set(key, client);
  }
  return client;
}

/**
 * Service-role client for server code: real Supabase, the local backend, or
 * null in demo mode (quotes compute and render, nothing persists). The local
 * client speaks the same API, so callers never branch on which one they got.
 */
export function getServiceClient(): SupabaseClient | null {
  const backend = dataBackend();
  if (backend === "supabase") {
    // Writes lose any NUL first: Postgres refuses it in text and jsonb (lib/db/no-nul.ts).
    return nulSafe(
      createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false },
      }),
    );
  }
  if (backend === "none") return null;
  return localClient(backend);
}

/**
 * The client, or a clear error. For new pilot code, where demo mode has no
 * meaning: a proposal that silently didn't save is worse than a 500.
 */
export function requireDb(): SupabaseClient {
  const db = getServiceClient();
  if (!db) {
    throw new Error(
      "No database: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or DATA_BACKEND=file to use the local backend.",
    );
  }
  return db;
}
