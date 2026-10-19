import Link from "next/link";
import type { Metadata } from "next";
import { ROLE_LABEL } from "@aircon/domain";
import { Logo } from "@/components/site/logo";
import { breakGlassEnabled, safeNextPath, staffLanding } from "@/lib/auth/access";
import { DEMO_ROLE_KEYS, DEMO_ROLE_LABEL } from "@/lib/auth/demo-staff";
import { currentStaff } from "@/lib/auth/server";
import { demoModeAllowed } from "@/lib/auth/demo-guard";
import { appMode } from "@/lib/env-mode";
import { PILOT_UPGRADE, needsUpgrade, pilotSchemaStatus } from "@/lib/schema-check";
import { demoSignIn } from "./actions";
import { DemoSeedButton } from "./demo-seed";
import { BreakGlassForm, MagicLinkForm } from "./forms";

export const metadata: Metadata = {
  title: "Team sign-in",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ERRORS: Record<string, string> = {
  expired: "That sign-in link has expired or was already used. Ask for a new one below.",
  missing: "That sign-in link was incomplete. Ask for a new one below.",
  unavailable: "Sign-in isn't available right now. Please try again shortly.",
};

const DEMO_HINT: Record<string, string> = {
  admin: "Everything, including settings",
  surveyor: "Home surveys and designs",
  "tech-lead": "Approvals and commissioning",
  installer: "Field jobs",
  electrician: "Electrical steps",
  "external-installer": "Assigned jobs only",
};

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const rawNext = first(sp.next);
  const next = safeNextPath(rawNext, "");
  const error = ERRORS[first(sp.error) ?? ""];
  const signedOut = first(sp.signedOut) === "1";

  const staff = await currentStaff();
  // Off on any database holding something real, whatever the flags say (lib/auth/demo-guard).
  const demoAllowed = await demoModeAllowed();
  const breakGlass = breakGlassEnabled(process.env);
  // Set, but switched off (a template value, or a short password left from the old site's basic auth):
  // say so here, where the founder is stuck on launch day, never what the value is.
  const breakGlassOff = !breakGlass && Boolean(process.env.OPS_PASSWORD?.trim());
  const mode = appMode();
  // Supabase connected but the pilot migration never ran: say so here, where
  // everyone lands (every diagnostic page is behind this sign-in).
  const schema = mode.data === "supabase" ? await pilotSchemaStatus().catch(() => null) : null;
  const notMigrated = needsUpgrade(schema);
  // "Load demo pilots": anyone in development; on a demo deployment, admins only
  // (the route checks the same thing). Needs somewhere to put them.
  const canSeed =
    demoAllowed &&
    mode.data !== "demo" &&
    (process.env.NODE_ENV !== "production" || Boolean(staff?.roles.includes("admin")));

  return (
    <main className="min-h-dvh bg-cream px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <Link href="/" aria-label="Home" className="inline-block">
          <Logo />
        </Link>

        <h1 className="mt-8 font-display text-3xl text-ink-900 sm:text-4xl">Team sign-in</h1>
        <p className="mt-2 text-ink-500">
          For the Dang, It&apos;s Hot team and our installers. We email you a link, no passwords.
        </p>

        {notMigrated && (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
            <p className="font-semibold">The database isn&apos;t set up for sign-in yet.</p>
            <p className="mt-1">
              Supabase is connected, but the pilot platform&apos;s upgrade hasn&apos;t been run. In Supabase → SQL Editor, paste and run{" "}
              <code className="font-mono text-xs">{PILOT_UPGRADE}</code> (a brand-new, empty project first needs 0001 to 0009 from{" "}
              <code className="font-mono text-xs">supabase/migrations</code>), then reload this page.
              {breakGlass ? " Until then, an admin email with the break-glass password opens /ops/status to check." : ""}
            </p>
          </div>
        )}
        {error && (
          <p className="mt-6 rounded-2xl border border-accent-100 bg-accent-50 p-4 text-sm text-ink-900" role="alert">
            {error}
          </p>
        )}
        {signedOut && !staff && (
          <p className="mt-6 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-700" role="status">
            You&apos;re signed out.
          </p>
        )}

        {staff ? (
          <section className="mt-8 rounded-2xl border border-line bg-white p-6">
            <p className="text-sm text-ink-500">Signed in as</p>
            <p className="mt-1 text-lg font-semibold text-ink-900">{staff.name}</p>
            <p className="text-sm text-ink-500">
              {staff.roles.map((r) => ROLE_LABEL[r]).join(", ") || "No role yet"}
              {staff.external ? " · subcontractor" : ""}
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link
                href={staffLanding(staff, next)}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-accent-700 px-6 py-3 font-semibold text-white transition hover:bg-accent-800"
              >
                Continue
              </Link>
              <form action="/auth/logout" method="post" className="flex-1">
                <button
                  type="submit"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-line bg-white px-6 py-3 font-semibold text-ink-900 transition hover:border-ink-300"
                >
                  Sign out
                </button>
              </form>
            </div>
          </section>
        ) : (
          <section className="mt-8 rounded-2xl border border-line bg-white p-6">
            <MagicLinkForm next={next} />
          </section>
        )}

        {demoAllowed && (
          <section className="mt-6 rounded-2xl border border-dashed border-ink-300 bg-surface p-6">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-ink-900 px-2.5 py-0.5 text-xs font-bold tracking-wide text-white">DEMO</span>
              <h2 className="font-semibold text-ink-900">Try as…</h2>
            </div>
            <p className="mt-2 text-sm text-ink-500">
              Fictional team members, one per role. Nothing here is a real person or a real home.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DEMO_ROLE_KEYS.map((role) => (
                <form key={role} action={demoSignIn}>
                  <input type="hidden" name="role" value={role} />
                  <input type="hidden" name="next" value={next} />
                  <button
                    type="submit"
                    className="flex min-h-12 w-full flex-col items-start rounded-2xl border border-line bg-white px-4 py-2.5 text-left transition hover:border-accent-400"
                  >
                    <span className="font-semibold text-ink-900">{DEMO_ROLE_LABEL[role]}</span>
                    <span className="text-xs text-ink-500">{DEMO_HINT[role]}</span>
                  </button>
                </form>
              ))}
            </div>
            {canSeed && <DemoSeedButton />}
          </section>
        )}

        {breakGlass && !staff && (
          <details className="mt-6 rounded-2xl border border-line bg-white p-6">
            <summary className="cursor-pointer font-semibold text-ink-900">Admin break-glass</summary>
            <p className="mt-2 text-sm text-ink-500">
              For when email is down. An admin email plus the ops password; the session lasts 12 hours and is
              logged.
            </p>
            <BreakGlassForm next={next} />
          </details>
        )}
        {breakGlassOff && !staff && (
          <p className="mt-6 rounded-2xl border border-line bg-white p-4 text-sm text-ink-700">
            Admin break-glass is switched off: <code className="font-mono text-xs">OPS_PASSWORD</code> is a template value or shorter than 20
            characters. In Vercel, edit it to a new one (<code className="font-mono text-xs">openssl rand -base64 24</code>), then redeploy.
          </p>
        )}

        <p className="mt-8 text-sm text-ink-500">
          Looking for your home&apos;s project? Use the link in your latest email from us, or{" "}
          <Link href="/portal" className="font-semibold text-accent-700 underline underline-offset-2">
            go to your portal
          </Link>
          .
        </p>

        {(mode.data === "demo" || mode.email === "demo") && (
          <p className="mt-4 text-xs text-ink-500">
            {mode.data === "demo"
              ? "Demo mode: no database is connected, so sign-in links can't be issued."
              : process.env.NODE_ENV !== "production"
                ? "Email isn't set up here, so your sign-in link appears on screen instead (development only)."
                : "Email isn't set up on this deployment, so sign-in links can't be emailed yet."}
          </p>
        )}
      </div>
    </main>
  );
}
