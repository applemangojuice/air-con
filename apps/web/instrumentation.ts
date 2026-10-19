/**
 * Runs once when a server instance starts (Next.js instrumentation hook).
 * Only says things: unsafe or switched-off sign-in configuration, template
 * values, and a database missing its migrations go to the deployment logs
 * as errors, so nobody finds out from an incident.
 */
export async function register(): Promise<void> {
  // The import sits inside the runtime check so the edge build leaves it out.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootChecks } = await import("./instrumentation-node");
    bootChecks();
  }
}
