import { demoLoginAllowed } from "./auth/access";
import { emailConfigured } from "./email";
import { isPlaceholderValue, realEnv } from "./env-placeholders";
import { dataBackend } from "./supabase-server";

/**
 * What's real and what's pretend in this deployment (contract §F), for the
 * mode banner and the status page. Honest states: anything that isn't live
 * says so on screen.
 *
 *  * data: where records go. "demo" = no database, nothing persists.
 *  * email / sms: "demo" = messages are rendered and stored in the outbox
 *    with status "demo", never sent.
 *  * payments: "test" = Stripe test keys (no real money), "demo" = no Stripe
 *    at all (bank transfer recorded by hand, plus a labelled simulate button
 *    outside production).
 */

export interface AppMode {
  data: "supabase" | "file" | "memory" | "demo";
  email: "live" | "demo";
  sms: "live" | "demo";
  payments: "live" | "test" | "demo";
}

export function appMode(env: Record<string, string | undefined> = process.env): AppMode {
  const backend = dataBackend();
  // A template key (sk_test_xxx) is no key: honestly demo.
  const stripeKey = isPlaceholderValue(env.STRIPE_SECRET_KEY) ? "" : (env.STRIPE_SECRET_KEY ?? "");
  return {
    data: backend === "none" ? "demo" : backend,
    email: emailConfigured() ? "live" : "demo",
    sms: realEnv(env, "TWILIO_ACCOUNT_SID") && realEnv(env, "TWILIO_AUTH_TOKEN") && env.TWILIO_FROM ? "live" : "demo",
    payments: /^(sk|rk)_live_/.test(stripeKey) ? "live" : /^(sk|rk)_test_/.test(stripeKey) ? "test" : "demo",
  };
}

/** True when everything is live: the only state that needs no banner. */
export function isFullyLive(mode: AppMode = appMode()): boolean {
  return mode.data === "supabase" && mode.email === "live" && mode.sms === "live" && mode.payments === "live";
}

/** The "Try as…" demo sign-in (contract §C): off in production unless ALLOW_DEMO_LOGIN=1. */
export function isDemoLoginAllowed(): boolean {
  return demoLoginAllowed(process.env);
}
