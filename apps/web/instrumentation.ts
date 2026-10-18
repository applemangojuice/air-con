import { securityWarnings } from "./lib/auth/access";

/**
 * Runs once when a server instance starts (Next.js instrumentation hook).
 * Only says things: unsafe or switched-off sign-in configuration goes to the
 * deployment logs as an error, so nobody finds out from an incident.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  for (const warning of securityWarnings(process.env)) console.error(`[security] ${warning}`);
}
