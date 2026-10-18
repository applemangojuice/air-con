import { MIN_BREAK_GLASS_PASSWORD, breakGlassEnabled } from "./auth/access";
import { MIN_SESSION_SECRET_LENGTH, sessionSecretUsable } from "./auth/session";
import { getServiceClient } from "./supabase-server";
import { MEDIA_BUCKET, PHOTO_BUCKET, VIDEO_BUCKET } from "./supabase-server";

/**
 * Database self-check. Every symptom of "the site isn't saving anything"
 * comes back to the same handful of questions: are the Supabase keys set, can
 * we reach the project, and does each table/bucket the app writes to actually
 * exist? This answers all of them so /ops/status can show a plain checklist
 * instead of the user guessing.
 */

export interface TableCheck {
  table: string;
  label: string;
  ok: boolean;
  count: number | null;
  error: string | null;
  /** What breaks for the customer when this table is missing. */
  impact: string;
}

export interface BucketCheck {
  bucket: string;
  label: string;
  ok: boolean;
  error: string | null;
}

export interface EnvCheck {
  key: string;
  label: string;
  set: boolean;
  required: boolean;
  note: string;
}

export interface HealthReport {
  configured: boolean;
  reachable: boolean;
  connectionError: string | null;
  tables: TableCheck[];
  buckets: BucketCheck[];
  env: EnvCheck[];
  /** true when every required table + bucket is present. */
  healthy: boolean;
}

const TABLES: { table: string; label: string; impact: string }[] = [
  {
    table: "quote_requests",
    label: "Quote requests",
    impact: "Customers can't save quotes — the funnel errors at the end and the lead is lost.",
  },
  {
    table: "projects",
    label: "Projects",
    impact: "Saved quotes can't start a project; the install timeline won't load.",
  },
  {
    table: "properties",
    label: "Properties (intelligence)",
    impact: "Property Intelligence shows 0 and address prefill is unavailable.",
  },
  {
    table: "property_assessments",
    label: "Property assessments",
    impact: "The importer can't log where each property fact came from.",
  },
  {
    table: "video_surveys",
    label: "Video surveys",
    impact: "Video walkthrough capture can't be stored.",
  },
  {
    table: "analytics_events",
    label: "Analytics events",
    impact: "Usage analytics aren't recorded — no visitor, source or funnel data.",
  },
  // Pilot platform (migration 0010): without these nobody can sign in.
  {
    table: "staff",
    label: "Staff",
    impact: "Nobody can sign in to /ops or /field: there's nowhere to keep the team.",
  },
  {
    table: "login_tokens",
    label: "Sign-in links",
    impact: "Magic sign-in links can't be issued or checked.",
  },
  {
    table: "messages",
    label: "Message outbox",
    impact: "Customer and team messages aren't recorded or sent.",
  },
  {
    table: "audit_log",
    label: "Audit log",
    impact: "Sign-ins and changes aren't recorded against who made them.",
  },
];

async function checkTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  t: { table: string; label: string; impact: string },
): Promise<TableCheck> {
  const { count, error } = await supabase
    .from(t.table)
    .select("*", { count: "exact", head: true });
  return {
    table: t.table,
    label: t.label,
    ok: !error,
    count: error ? null : (count ?? 0),
    error: error?.message ?? null,
    impact: t.impact,
  };
}

async function checkBucket(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  bucket: string,
  label: string,
): Promise<BucketCheck> {
  const { error } = await supabase.storage.getBucket(bucket);
  return { bucket, label, ok: !error, error: error?.message ?? null };
}

function envReport(): EnvCheck[] {
  const has = (k: string) => Boolean(process.env[k]);
  const emailReady = has("RESEND_API_KEY") && has("EMAIL_FROM");
  return [
    {
      key: "SUPABASE_URL",
      label: "Supabase URL",
      set: has("SUPABASE_URL"),
      required: true,
      note: "Persistence. Without it the whole site runs in demo mode.",
    },
    {
      key: "SUPABASE_SERVICE_ROLE_KEY",
      label: "Supabase service-role key",
      set: has("SUPABASE_SERVICE_ROLE_KEY"),
      required: true,
      note: "Server-side writes. Pair with SUPABASE_URL.",
    },
    {
      key: "SESSION_SECRET",
      label: "Session secret",
      set: sessionSecretUsable(process.env),
      required: true,
      note: has("SESSION_SECRET") && !sessionSecretUsable(process.env)
        ? `Set but too short: production ignores a secret under ${MIN_SESSION_SECRET_LENGTH} characters, so nobody can sign in. Generate one with \`openssl rand -hex 32\`.`
        : "Signs staff and customer sessions. Without it production signs nobody in. Generate with `openssl rand -hex 32`.",
    },
    {
      key: "ADMIN_EMAILS",
      label: "Admin emails",
      set: has("ADMIN_EMAILS"),
      required: false,
      note: "Comma list. The first sign-in from one of these creates its admin account.",
    },
    {
      key: "OPS_PASSWORD",
      label: "Break-glass password",
      set: breakGlassEnabled(process.env),
      required: false,
      note: has("OPS_PASSWORD") && !breakGlassEnabled(process.env)
        ? `Set but too short: break-glass is off until it's at least ${MIN_BREAK_GLASS_PASSWORD} characters.`
        : `Optional: lets an admin email sign in with this password when email is down. At least ${MIN_BREAK_GLASS_PASSWORD} characters.`,
    },
    {
      key: "RESEND_API_KEY",
      label: "Email (Resend)",
      set: emailReady,
      required: false,
      note: "Quote emails to customers + new-lead / lost-lead alerts to the team. Needs RESEND_API_KEY + EMAIL_FROM.",
    },
    {
      key: "LEADS_NOTIFY_EMAIL",
      label: "Lead alerts inbox",
      set: has("LEADS_NOTIFY_EMAIL"),
      required: false,
      note: "Where new-lead and lost-lead alerts go. Defaults to the EMAIL_FROM address.",
    },
    {
      key: "GETADDRESS_API_KEY",
      label: "Address autofill",
      set: has("GETADDRESS_API_KEY"),
      required: false,
      note: "Postcode → address lookup for the funnel. Optional.",
    },
    {
      key: "CRON_SECRET",
      label: "Follow-up cron",
      set: has("CRON_SECRET"),
      required: false,
      note: "Enables the daily abandoned-quote follow-up email (needs Resend too).",
    },
    {
      key: "NEXT_PUBLIC_APP_URL",
      label: "Public app URL",
      set: has("NEXT_PUBLIC_APP_URL"),
      required: false,
      note: "Used in emails and links. Set to your live domain.",
    },
  ];
}

export async function healthReport(): Promise<HealthReport> {
  const env = envReport();
  const supabase = getServiceClient();
  if (!supabase) {
    return {
      configured: false,
      reachable: false,
      connectionError: null,
      tables: [],
      buckets: [],
      env,
      healthy: false,
    };
  }

  const tables = await Promise.all(TABLES.map((t) => checkTable(supabase, t)));
  const buckets = await Promise.all([
    checkBucket(supabase, PHOTO_BUCKET, "Survey photos"),
    checkBucket(supabase, VIDEO_BUCKET, "Survey videos"),
    checkBucket(supabase, MEDIA_BUCKET, "Project media"),
  ]);

  // If every table errors identically, the project itself is unreachable
  // (bad URL/key) rather than just un-migrated.
  const allFailed = tables.every((t) => !t.ok);
  const connectionError = allFailed ? (tables[0]?.error ?? "unreachable") : null;

  const healthy = tables.every((t) => t.ok) && buckets.every((b) => b.ok);

  return {
    configured: true,
    reachable: !allFailed,
    connectionError,
    tables,
    buckets,
    env,
    healthy,
  };
}
