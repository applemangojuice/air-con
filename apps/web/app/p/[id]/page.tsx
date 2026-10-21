import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoHub } from "@/components/portal/demo-hub";
import { LiveHub } from "@/components/portal/live-hub";
import { CustomerNav, PortalShell, StaffNav } from "@/components/portal/shell";
import { LinkRequest } from "@/components/portal/sign-in";
import { requireProjectAccess } from "@/lib/auth/server";
import { loadHub } from "@/lib/portal-server";
import { buildDemoProject } from "@/lib/project-service";
import { getSettings } from "@/lib/settings-server";
import { reachUs, realPhone } from "@/components/site/claims";

export const metadata: Metadata = {
  title: "Your project",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The customer hub (contract §G F1). `/p/demo` is the playable browser
 * demo; real projects live at `/p/<uuid>` and need the project's own
 * customer signed in (or a team member who can see it, read-only). Anyone
 * else gets the same calm sign-in page, whether or not the project exists.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;

  if (rawId === "demo") {
    return (
      <PortalShell right={<span className="rounded-full bg-ink-900 px-3 py-1 text-xs font-bold tracking-wide text-white">DEMO</span>}>
        <DemoHub initialProject={buildDemoProject()} />
      </PortalShell>
    );
  }
  if (!UUID_RE.test(rawId)) notFound();
  const id = rawId.toLowerCase();

  const [access, settings] = await Promise.all([requireProjectAccess(id, { allowCustomer: true, customerSide: true }), getSettings()]);
  const phone = realPhone(settings.company.phone);

  if (!access) {
    return (
      <PortalShell width="narrow">
        <div className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <p className="text-sm font-semibold text-accent-700">Your project</p>
          <h1 className="mt-1 font-display text-3xl leading-tight text-ink-900">Sign in to see your project</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-700">
            Your project page shows your home, your dates and your documents, so it&apos;s private. We&apos;ll email a sign-in link to the address we have for
            this project: one tap and you&apos;re in, no password.
          </p>
          <div className="mt-6">
            <LinkRequest target={{ projectId: id }} phone={phone} email={settings.company.email} />
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-ink-500">
          Just looking around?{" "}
          <a href="/p/demo" className="font-semibold text-accent-700 underline underline-offset-2">
            Try the demo project
          </a>
          .
        </p>
      </PortalShell>
    );
  }

  const data = await loadHub(id, access).catch((err) => {
    console.error(`[portal] hub for ${id} failed to load:`, err);
    return null;
  });
  const right = access.kind === "staff" ? <StaffNav href={`/ops/projects/${id}`} /> : <CustomerNav />;

  if (!data) {
    return (
      <PortalShell right={right} width="narrow">
        <div role="alert" className="rounded-3xl border border-line bg-white p-6 sm:p-8">
          <h1 className="font-display text-2xl text-ink-900">We couldn&apos;t load your project just now</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-700">
            That&apos;s on us, not you. Try again in a moment, or {reachUs(settings.company)} and we&apos;ll help straight away.
          </p>
          <a href={`/p/${id}`} className="mt-5 inline-flex min-h-12 items-center rounded-full bg-accent-700 px-6 font-semibold text-white hover:bg-accent-800">
            Try again
          </a>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell right={right}>
      <LiveHub data={data} />
    </PortalShell>
  );
}
