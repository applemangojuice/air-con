import Link from "next/link";
import type { Metadata } from "next";
import { healthReport } from "@/lib/health";
import { appUrl } from "@/lib/brand";
import { getServiceClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Launch readiness · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * The "are we actually ready to go public?" page. Everything the platform
 * can verify about itself is verified live; everything that needs a human
 * (domains, DNS, a real test quote) is a checklist with exact instructions.
 * The goal: launch day is a walk down this page, not a scramble.
 */

interface Check {
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

async function liveChecks(): Promise<{ checks: Check[]; score: number; total: number }> {
  const report = await healthReport();
  const supabase = getServiceClient();

  const checks: Check[] = [];

  checks.push({
    label: "Database connected & fully migrated",
    ok: report.configured && report.reachable && report.tables.every((t) => t.ok),
    detail: report.configured
      ? report.tables.every((t) => t.ok)
        ? "All tables present."
        : `Missing: ${report.tables.filter((t) => !t.ok).map((t) => t.table).join(", ")}`
      : "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — demo mode, nothing saves.",
    fix: "Run supabase/migrations 0001→0008 in the SQL editor; check /ops/status.",
  });

  checks.push({
    label: "Photo & video storage buckets",
    ok: report.buckets.every((b) => b.ok),
    detail: report.buckets.every((b) => b.ok)
      ? "Both buckets present."
      : "Missing bucket — photo uploads will fail with 'invalid path'.",
    fix: "Migration 0001 creates survey-photos; 0004 creates survey-videos.",
  });

  const env = (k: string) => report.env.find((e) => e.key === k)?.set ?? false;
  checks.push({
    label: "Ops console password",
    ok: env("OPS_PASSWORD"),
    detail: env("OPS_PASSWORD")
      ? "Set — /ops is gated."
      : "NOT SET: anyone with the URL can read leads, bookings and traffic.",
    fix: "Set OPS_PASSWORD in Vercel env vars and redeploy.",
  });

  checks.push({
    label: "Email (customer quotes, booking confirmations, lead alerts)",
    ok: env("RESEND_API_KEY"),
    detail: env("RESEND_API_KEY")
      ? "Resend configured."
      : "Not configured: no quote emails, no booking confirmations, no lost-lead safety net.",
    fix: "Set RESEND_API_KEY + EMAIL_FROM (+ LEADS_NOTIFY_EMAIL) in Vercel.",
  });

  checks.push({
    label: "Automations (follow-up nudge + daily digest)",
    ok: env("CRON_SECRET"),
    detail: env("CRON_SECRET")
      ? "CRON_SECRET set — Vercel crons will authenticate."
      : "Not set: abandoned-quote follow-ups and the daily digest won't run.",
    fix: "Set CRON_SECRET (any long random string) in Vercel.",
  });

  checks.push({
    label: "Public URL configured",
    ok: env("NEXT_PUBLIC_APP_URL"),
    detail: env("NEXT_PUBLIC_APP_URL")
      ? `Links in emails and collateral point at ${appUrl()}.`
      : `Not set — links fall back to ${appUrl()}.`,
    fix: "Set NEXT_PUBLIC_APP_URL to the live domain in Vercel.",
  });

  if (supabase) {
    const { count: propertyCount } = await supabase
      .from("properties")
      .select("*", { count: "exact", head: true });
    checks.push({
      label: "Property intelligence has data",
      ok: (propertyCount ?? 0) > 0,
      detail:
        (propertyCount ?? 0) > 0
          ? `${(propertyCount ?? 0).toLocaleString("en-GB")} properties in the book.`
          : "Empty — address prefill and per-address pages have nothing to serve.",
      fix: "Seed the sample book on /ops/intel, or run the EPC importer (docs/loading-data.md).",
    });

    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count: eventCount } = await supabase
      .from("analytics_events")
      .select("*", { count: "exact", head: true })
      .gte("created_at", dayAgo);
    checks.push({
      label: "Analytics receiving events",
      ok: (eventCount ?? 0) > 0,
      detail:
        (eventCount ?? 0) > 0
          ? `${eventCount} events in the last 24h.`
          : "No events in 24h — either no traffic yet, or the beacon isn't reaching the database.",
      fix: "Visit the site once and refresh; if still zero, check /ops/status for the analytics_events table.",
    });
  }

  const score = checks.filter((c) => c.ok).length;
  return { checks, score, total: checks.length };
}

/** The launch-day items only a human can do, with the exact verification. */
const MANUAL: { label: string; how: string }[] = [
  {
    label: "Domain live on Vercel",
    how: "Vercel → Project → Domains: the production domain resolves with a padlock, and NEXT_PUBLIC_APP_URL matches it exactly.",
  },
  {
    label: "Email domain verified (SPF/DKIM)",
    how: "Resend → Domains: verified, so quote emails land in inboxes, not spam. Send yourself one from the funnel to confirm.",
  },
  {
    label: "Walk the money path end-to-end",
    how: "On the LIVE site: get a quote with photos → check the quote email arrives → find it in /ops/quotes → book it → check the booking confirmation + team alert arrive.",
  },
  {
    label: "Run the automated funnel test against production",
    how: "BASE_URL=https://your-domain pnpm --filter @aircon/web test:e2e — all seven checks green.",
  },
  {
    label: "Share preview looks right",
    how: "Paste the homepage and an /areas page into WhatsApp: the branded card and the page-specific title should show.",
  },
  {
    label: "Uptime alarm armed",
    how: "GitHub → repo → Settings → Variables: SITE_URL set to the live domain; run the Health check workflow once manually — green.",
  },
  {
    label: "Legal reviewed",
    how: "/privacy and /terms carry today's business reality; a solicitor's once-over before serious ad spend.",
  },
];

export default async function LaunchPage() {
  const { checks, score, total } = await liveChecks();
  const ready = score === total;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display">Launch readiness</h1>
          <p className="mt-1 text-sm text-ink-500">
            Everything the platform can check, checked live. Everything it can&apos;t, listed.
          </p>
        </div>
        <Link href="/ops" className="text-sm font-medium text-accent-700 hover:underline">
          ← All modules
        </Link>
      </div>

      <div
        className={`rounded-2xl border p-5 ${
          ready ? "border-sage-200 bg-sage-50" : "border-amber-200 bg-amber-50"
        }`}
      >
        <p className={`text-3xl font-display ${ready ? "text-sage-800" : "text-amber-800"}`}>
          {score}/{total} automated checks green
        </p>
        <p className={`mt-1 text-sm ${ready ? "text-sage-700" : "text-amber-700"}`}>
          {ready
            ? "The platform side is ready. Walk the manual list below and go."
            : "Fix the red rows below first — each one is customer-visible."}
        </p>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-display">Checked live, right now</h2>
        <div className="divide-y divide-line rounded-2xl border border-line">
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-3 px-4 py-3">
              <span
                aria-hidden
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${c.ok ? "bg-sage-500" : "bg-red-500"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{c.label}</p>
                <p className="text-sm text-ink-500">{c.detail}</p>
                {!c.ok && c.fix && <p className="mt-0.5 text-xs text-accent-700">{c.fix}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-display">Launch-day walk (human required)</h2>
        <div className="divide-y divide-line rounded-2xl border border-line">
          {MANUAL.map((m, i) => (
            <div key={m.label} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 shrink-0 rounded-full bg-surface px-2 py-0.5 text-xs font-bold text-ink-500">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{m.label}</p>
                <p className="text-sm text-ink-500">{m.how}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-8 text-xs text-ink-300">
        After launch, this page stays useful: it&apos;s the first stop when anything smells off,
        alongside{" "}
        <Link href="/ops/status" className="text-accent-700 hover:underline">
          system status
        </Link>
        .
      </p>
    </main>
  );
}
