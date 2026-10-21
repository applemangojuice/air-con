/**
 * Template values. `apps/web/.env.example` (and older copies of it, and
 * docs) once shipped values like `SESSION_SECRET=generate-with-openssl-rand-hex-32`
 * that pass a length check, so a deployment that pasted the file in as-is
 * would sign sessions with a secret published in the repo, turn break-glass
 * on with a known password, and look "configured" for email, SMS and
 * Stripe with junk keys. A value that only ever came from a template counts
 * as not set, everywhere: sessions, break-glass, providers, crons, the
 * data backend, /ops/status and /ops/launch, and the boot warnings.
 *
 * Pure (no Node APIs): middleware and the edge runtime use it too.
 */

/**
 * The exact template strings that have shipped, in any version of
 * `.env.example` (`git log -p -- apps/web/.env.example`), compared
 * case-insensitively. Main's original template matters most: the live
 * Vercel project was set up from it, so its `OPS_PASSWORD` (once a basic-auth
 * password, now the key to the whole admin console) may still be it.
 */
const KNOWN_PLACEHOLDERS = new Set(
  [
    "generate-with-openssl-rand-hex-32",
    "at-least-twenty-random-characters",
    // OPS_PASSWORD on main's first .env.example: 21 characters, so it passed the length check.
    "pick-something-strong",
    // LEADS_NOTIFY_EMAIL and ADMIN_EMAILS / EPC_API_EMAIL templates: nobody's inbox.
    "you@dang.ac",
    "you@example.com",
    "generate-a-long-random-string",
    "your-service-role-key",
    "https://your-project.supabase.co",
    "your-getaddress-key",
    "your-twilio-auth-token",
    "your-epc-api-key",
    "re_xxx",
    "sk_test_xxx",
    "sk_live_xxx",
    "whsec_xxx",
    "sk-...",
    "sk-ant-...",
  ].map((s) => s.toLowerCase()),
);

/** Is this a template value rather than a real one? Empty is "not set", not a placeholder. */
export function isPlaceholderValue(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  if (KNOWN_PLACEHOLDERS.has(v.toLowerCase())) return true;
  // A provider prefix and then only x's (re_xxx, sk_test_xxxx, ACxxxx…, whsec_xxx).
  if (/^(re|sk_test|sk_live|rk_test|rk_live|whsec|ac|sk|sk-ant|pk_test|pk_live)[_-]?x{3,}$/i.test(v)) return true;
  if (/^(sk|sk-ant)-\.{2,}$/i.test(v)) return true;
  // Instructions rather than values.
  if (/^(your|generate|change|replace|paste)[-_ ]/i.test(v)) return true;
  if (/^(changeme|placeholder|example|todo|tbd|x{3,}|\.{3,})$/i.test(v)) return true;
  if (/your-project\.supabase\.co/i.test(v)) return true;
  // A template domain anywhere: "Breeze <quotes@yourdomain.co.uk>", https://yourdomain.co.uk, hello@yourdomain.co.uk.
  if (/(^|[@/.<\s])yourdomain\./i.test(v)) return true;
  return false;
}

/** The variable's value when it's really set: not empty and not a template placeholder. */
export function realEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const v = env[key]?.trim();
  return v && !isPlaceholderValue(v) ? v : undefined;
}

/** Secrets and keys worth naming when they still hold a template value. */
export const PLACEHOLDER_CHECKED_KEYS = [
  "SESSION_SECRET",
  "OPS_PASSWORD",
  "ADMIN_EMAILS",
  "CRON_SECRET",
  "EMAIL_FROM",
  "LEADS_NOTIFY_EMAIL",
  "NEXT_PUBLIC_APP_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "GETADDRESS_API_KEY",
  "EPC_BEARER_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

/** Which of those still hold a template value (so they're treated as unset). */
export function placeholderKeys(env: Record<string, string | undefined>): string[] {
  return PLACEHOLDER_CHECKED_KEYS.filter((k) => isPlaceholderValue(env[k]));
}

/** The cron bearer secret, or null (every cron then answers 401). A template value is no secret. */
export function cronSecret(env: Record<string, string | undefined> = process.env): string | null {
  return realEnv(env, "CRON_SECRET") ?? null;
}
