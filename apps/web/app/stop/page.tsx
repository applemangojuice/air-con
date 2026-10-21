import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/site/logo";
import { stopLinkValid } from "@/lib/follow-up-stop";
import { loadProject } from "@/lib/project-service";
import { getPublicSettings } from "@/lib/public-settings";
import { stopFollowUpsAction } from "./actions";
import { StopForm } from "./stop-form";

export const metadata: Metadata = { title: "Stop follow-up emails", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Where a follow-up's footer link lands: one button that turns follow-ups
 * off for that project (check-ins, the season's tips, the yearly service
 * reminder), no sign-in needed. The link is signed for the project
 * (lib/follow-up-stop); anything else gets the way to do it by hand.
 */
export default async function StopPage({ searchParams }: { searchParams: Promise<{ p?: string; s?: string }> }) {
  const { p, s } = await searchParams;
  const settings = await getPublicSettings().catch(() => null);
  const email = settings?.company.email;
  const valid = await stopLinkValid(p, s);
  const project = valid && p ? await loadProject(p).catch(() => null) : null;
  return (
    <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <Logo />
      <h1 className="mt-8 font-display text-3xl text-ink-900">Stop follow-up emails</h1>
      {!valid || !project ? (
        <p className="mt-4 text-base leading-relaxed text-ink-700">
          This link doesn&apos;t work. You can turn follow-ups off from your project page{email ? <>, or email <a className="font-semibold underline" href={`mailto:${email}`}>{email}</a> and we&apos;ll stop them</> : ""}.
        </p>
      ) : project.aftercare.followUpsOptedOutAt ? (
        <p className="mt-4 rounded-sm border border-emerald-200 bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-900">
          They&apos;re already off. We&apos;ll still contact you about any open work, problem or payment.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-base leading-relaxed text-ink-700">
            For your system at {project.customer.addressLine || project.customer.postcode || "your home"}: no more check-ins, change-of-season tips or yearly service reminders. We&apos;ll still contact you about any open work, problem or payment.
          </p>
          <StopForm action={stopFollowUpsAction.bind(null, p!, s!)} />
        </div>
      )}
      <p className="mt-8 text-sm text-ink-500">
        <Link href="/portal" className="font-semibold underline">
          Your project page
        </Link>{" "}
        has the same switch, and turns them back on.
      </p>
    </main>
  );
}
