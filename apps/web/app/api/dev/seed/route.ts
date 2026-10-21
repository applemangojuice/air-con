import { demoModeAllowed } from "@/lib/auth/demo-guard";
import { requireStaffApi } from "@/lib/auth/server";
import { audit } from "@/lib/audit";
import { isDevSeedRequest, resetDemoData } from "@/lib/demo-seed";
import { getSettings } from "@/lib/settings-server";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * POST /api/dev/seed: delete and rebuild the DEMO pilots (plan §J, "reset
 * demo data", development and demo deployments only).
 *
 * Allowed only where demo sign-in is (lib/auth/demo-guard demoModeAllowed:
 * never on a production database without DEMO_DEPLOYMENT=1, and never on
 * any Supabase database that holds a real quote, customer or team member,
 * whatever the flags say), and then only for:
 *  * a signed-in admin, or
 *  * in development, the login page's "Load demo pilots" button (a
 *    same-origin request carrying `x-dih-seed: login`; the custom header
 *    means another site can't send it without a CORS preflight we never answer).
 * Anything else gets a 404, so the route doesn't advertise itself.
 * Touches demo data only (lib/demo-seed).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export async function POST(request: Request): Promise<Response> {
  if (!(await demoModeAllowed())) return notFound();

  let actor: Awaited<ReturnType<typeof requireStaffApi>> | null = null;
  if (!isDevSeedRequest(process.env, request)) {
    actor = await requireStaffApi(request);
    if (actor instanceof Response || !actor.roles.includes("admin")) return notFound();
  }
  if (!getServiceClient()) {
    return Response.json({ error: "There's no database here, so there's nowhere to load the demo pilots." }, { status: 503 });
  }

  try {
    const summary = await resetDemoData({ now: new Date().toISOString(), settings: await getSettings() });
    await audit({
      actor: actor && !(actor instanceof Response) ? actor : { kind: "system", name: "demo seed (login page)" },
      action: "demo.seed",
      entity: "demo",
      detail: { cleared: summary.cleared, projects: summary.projects.map((p) => p.id) },
    });
    return Response.json({ ok: true, ...summary }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[demo-seed] failed:", err);
    return Response.json({ error: "The demo pilots couldn't be loaded. The server log says why." }, { status: 500 });
  }
}
