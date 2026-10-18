import type { Metadata } from "next";
import Link from "next/link";
import { STAGE_INFO } from "@aircon/domain";
import { primaryCls } from "@/components/portal/bits";
import { CustomerNav, PortalShell } from "@/components/portal/shell";
import { EmailSignIn } from "@/components/portal/sign-in";
import { getSession } from "@/lib/auth/server";
import { customerHomes } from "@/lib/portal-server";
import { getSettings } from "@/lib/settings-server";
import { reachUs, realPhone } from "@/components/site/claims";

export const metadata: Metadata = {
  title: "Your homes",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The customer portal's front door (contract §G F1). Signed in: "Your
 * homes", each with its stage and the one next step. Signed out: an email
 * box for a sign-in link, answered the same way whoever asks.
 */
export default async function PortalPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const signedOut = sp.signedOut === "1";
  const [session, settings] = await Promise.all([getSession(), getSettings()]);
  const homes = session?.kind === "customer" ? await customerHomes() : null;
  const phone = realPhone(settings.company.phone);

  if (homes) {
    const first = homes.name.replace(/\s*\(DEMO\)\s*/, "").split(" ")[0];
    return (
      <PortalShell right={<CustomerNav />} width="narrow">
        <p className="text-sm font-semibold text-accent-700">{first ? `Hello, ${first}` : "Hello"}</p>
        <h1 className="mt-1 font-display text-3xl leading-tight text-ink-900 sm:text-4xl">Your homes</h1>
        {homes.homes.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-line bg-white/60 px-6 py-10 text-center">
            <p className="font-semibold text-ink-900">No projects on this account yet</p>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">
              If you&apos;ve started one under a different email address, sign out and sign in with that one, or {reachUs(settings.company)}.
            </p>
            <Link href="/quote" className={`${primaryCls(false)} mt-5`}>
              Get a price for a home
            </Link>
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {homes.homes.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/p/${h.id}`}
                  className="block rounded-3xl border border-line bg-white p-5 shadow-sm transition hover:border-ink-300 sm:p-6"
                >
                  <span className="flex flex-wrap items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-display text-xl leading-tight text-ink-900">{h.addressLine || "Your home"}</span>
                      <span className="mt-0.5 block text-sm text-ink-500">{h.postcode}</span>
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                        h.closed ? "border-line bg-surface text-ink-700" : "border-accent-100 bg-accent-50 text-accent-700"
                      }`}
                    >
                      {h.closed ? "Complete" : STAGE_INFO[h.stage].label}
                    </span>
                  </span>
                  <span className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
                    <span className="text-[15px] text-ink-700">
                      {h.next ? (
                        <>
                          <span className="font-semibold text-ink-900">Next: </span>
                          {h.next.label}
                        </>
                      ) : (
                        "Nothing for you to do right now"
                      )}
                    </span>
                    <span aria-hidden className="text-ink-500">
                      →
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-8 text-sm text-ink-500">
          Questions?{" "}
          {phone && (
            <>
              Call us on{" "}
              <a href={`tel:${phone.replace(/\s+/g, "")}`} className="font-semibold text-accent-700 underline underline-offset-2">
                {phone}
              </a>{" "}
              or email{" "}
            </>
          )}
          {!phone && "Email us at "}
          <a href={`mailto:${settings.company.email}`} className="font-semibold text-accent-700 underline underline-offset-2">
            {settings.company.email}
          </a>
          .
        </p>
      </PortalShell>
    );
  }

  return (
    <PortalShell width="narrow">
      {signedOut && (
        <p role="status" className="mb-6 rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink-700">
          You&apos;re signed out.
        </p>
      )}
      {session?.kind === "staff" && (
        <p role="note" className="mb-6 rounded-2xl border border-sage-200 bg-sage-50 px-4 py-3 text-sm text-sage-900">
          You&apos;re signed in as a team member.{" "}
          <Link href="/ops" className="font-semibold underline underline-offset-2">
            Go to ops
          </Link>
          . Customers sign in below with their own email.
        </p>
      )}
      <div className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold text-accent-700">Your project</p>
        <h1 className="mt-1 font-display text-3xl leading-tight text-ink-900 sm:text-4xl">Sign in to your project</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-700">
          Your dates, your documents and the next thing to do, all in one place. We&apos;ll email you a link: one tap and you&apos;re in, no password to remember.
        </p>
        <div className="mt-6">
          <EmailSignIn phone={phone} email={settings.company.email} />
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/quote" className="rounded-3xl border border-line bg-white p-5 transition hover:border-ink-300">
          <span className="block font-semibold text-ink-900">No price yet?</span>
          <span className="mt-1 block text-sm text-ink-500">Get yours in about two minutes.</span>
        </Link>
        <Link href="/p/demo" className="rounded-3xl border border-line bg-white p-5 transition hover:border-ink-300">
          <span className="block font-semibold text-ink-900">Just looking?</span>
          <span className="mt-1 block text-sm text-ink-500">Play through a DEMO project, start to finish.</span>
        </Link>
      </div>
    </PortalShell>
  );
}
