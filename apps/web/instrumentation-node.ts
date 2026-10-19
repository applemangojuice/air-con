import { demoLoginAllowed, describeRealRecords, securityWarnings } from "./lib/auth/access";
import { realRecordsNow } from "./lib/auth/demo-guard";
import { PILOT_MIGRATION, checkPilotSchema } from "./lib/schema-check";
import { dataBackend } from "./lib/supabase-server";

/**
 * The Node side of instrumentation.ts (kept in its own module so the edge
 * build never pulls in the database client). Says things only.
 */
export function bootChecks(): void {
  for (const warning of securityWarnings(process.env)) console.error(`[security] ${warning}`);
  // Demo flags on a Supabase database: say whether the database itself turns them down (lib/auth/demo-guard).
  if (demoLoginAllowed(process.env) && dataBackend() === "supabase") {
    void realRecordsNow()
      .then((records) => {
        const found = records ? describeRealRecords(records) : "";
        if (!records || found) {
          console.error(
            `[security] Demo sign-in is switched on (ALLOW_DEMO_LOGIN / DEMO_DEPLOYMENT), but this database ${records ? `holds ${found}` : "couldn't be checked"}, so demo sign-in, the demo seed and simulated payments are all REFUSED. Remove both settings in Vercel.`,
          );
        }
      })
      .catch((err: unknown) => console.error("[security] demo check failed:", err));
  }
  // The schema, without holding up the boot: a missing pilot migration is in the deploy logs, not found at first sign-in.
  void checkPilotSchema()
    .then((s) => {
      if (!s.checked) return;
      if (s.missingTables.length || s.missingColumns.length) {
        console.error(
          `[schema] The database is missing ${[...s.missingTables, ...s.missingColumns].join(", ")}: run supabase/migrations in order (${PILOT_MIGRATION} is the pilot platform). Until then nobody can sign in and pilot records can't be saved.`,
        );
      } else if (s.errors.length) {
        console.error(`[schema] Couldn't check the database at boot: ${s.errors[0]}`);
      }
    })
    .catch((err: unknown) => console.error("[schema] boot check failed:", err));
}
