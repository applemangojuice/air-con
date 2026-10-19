import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBackend, getServiceClient } from "../supabase-server.ts";
import { demoAllowedWithData, demoLoginAllowed, isReservedDemoAddress, type RealRecords } from "./access.ts";

/**
 * The one check behind demo sign-in, the demo seed and every demo-mode
 * fallback (contract §C): the env flags (demoLoginAllowed) and, on a
 * Supabase database, a look at what it holds. A database with anything real
 * in it (a quote not from the demo seed, a customer on a real-looking
 * address, a team member who isn't a DEMO account) never gets demo sign-in,
 * whatever the flags say: a demo admin can see and change everything.
 *
 * "Real" means on an address a real person could own: a quote, customer or
 * team member on a reserved address (example.com, .test, .invalid: RFC 2606,
 * where the DEMO records live) is nobody's data, so a demo deployment stays a
 * demo when someone tries New pilot, the quote form or break-glass on it with
 * a made-up address. The demo seed's quotes (source 'demo') and the DEMO team
 * (staff.demo) never count either.
 *
 * The file and memory backends are a developer's own machine or a throwaway
 * demo, so the flags decide there. Without the flags nothing is asked (the
 * live business pays nothing for this). The answer is kept for a few
 * seconds per server instance, so a busy demo doesn't ask on every click;
 * a database that can't be asked (down, slow, not migrated) is a no.
 */

/** Rows looked at per table per check. A demo has a handful; a table with more than this is never only demo. */
export const RECORD_SAMPLE = 200;
const TTL_MS = 15_000;
const TIMEOUT_MS = 5_000;

type Rows = { data: unknown; error: { message: string } | null };

function rows(name: string, r: Rows): Record<string, unknown>[] {
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  // A GET always answers with an array; anything else is no answer (schema-check.ts).
  if (!Array.isArray(r.data)) throw new Error(`${name}: no answer`);
  return r.data as Record<string, unknown>[];
}

/**
 * How many of these rows are on an address a real person could own. A full
 * sample of reserved addresses could still hide a real one past it, so that
 * counts as one.
 */
function realAmong(name: string, r: Rows): number {
  const emails = rows(name, r).map((row) => String(row.email ?? ""));
  const real = emails.filter((e) => !isReservedDemoAddress(e)).length;
  return real || (emails.length >= RECORD_SAMPLE ? 1 : 0);
}

/** What's real on this database (pure reads, no writes). Throws when it can't tell. */
export async function countRealRecords(client: SupabaseClient): Promise<RealRecords> {
  const [quotes, customers, staff] = await Promise.all([
    client.from("quote_requests").select("email").neq("source", "demo").limit(RECORD_SAMPLE),
    client.from("customers").select("email").limit(RECORD_SAMPLE),
    client.from("staff").select("email").eq("demo", false).limit(RECORD_SAMPLE),
  ]);
  return {
    quotes: realAmong("quote_requests", quotes),
    customers: realAmong("customers", customers),
    staff: realAmong("staff", staff),
  };
}

let cached: { at: number; records: RealRecords | null } | null = null;
let inflight: Promise<RealRecords | null> | null = null;

/** For tests: forget the last answer. */
export function resetDemoGuardCache(): void {
  cached = null;
  inflight = null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms / 1000} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** What's real on the connected database, recently checked; null when it couldn't be asked. */
export async function realRecordsNow(): Promise<RealRecords | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.records;
  if (!inflight) {
    inflight = (async () => {
      try {
        const client = getServiceClient();
        if (!client) throw new Error("no database client");
        return await withTimeout(countRealRecords(client), TIMEOUT_MS);
      } catch (err) {
        console.error("[demo-guard] couldn't check the database for real records, so demo sign-in stays off:", err instanceof Error ? err.message : err);
        return null;
      }
    })().then((records) => {
      cached = { at: Date.now(), records };
      inflight = null;
      return records;
    });
  }
  return inflight;
}

/**
 * May demo sign-in, the demo seed and the demo fallbacks run here, now?
 * Use this, not demoLoginAllowed, anywhere a demo account or demo
 * behaviour could reach stored data.
 */
export async function demoModeAllowed(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!demoLoginAllowed(env)) return false;
  const backend = dataBackend();
  if (backend !== "supabase") return true;
  return demoAllowedWithData(env, backend, await realRecordsNow());
}
