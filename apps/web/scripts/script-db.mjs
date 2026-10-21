/**
 * The database for the data scripts: Supabase when SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are set (env or apps/web/.env.local), else the
 * local backend when DATA_BACKEND is "file" (a developer's own data under
 * apps/web/.data, the same store `pnpm dev` uses). Needs
 * `node --experimental-strip-types` for the local backend.
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";

export function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

export async function scriptDb() {
  loadEnvLocal();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return createClient(url, key, { auth: { persistSession: false } });
  if (process.env.DATA_BACKEND === "file") {
    const { createLocalClient, defaultDataDir } = await import("../lib/db/local-client.ts");
    return createLocalClient({ backend: "file", dataDir: defaultDataDir() });
  }
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or fill apps/web/.env.local), or DATA_BACKEND=file for local data.");
  process.exit(1);
}
