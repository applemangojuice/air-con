import Link from "next/link";
import type { Metadata } from "next";
import { ROLE_LABEL } from "@aircon/domain";
import { Logo } from "@/components/site/logo";
import { safeNextPath, staffHome } from "@/lib/auth/access";
import { currentStaff } from "@/lib/auth/server";

export const metadata: Metadata = {
  title: "No access",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Where requireStaff sends someone who is signed in but lacks the
 * permission a page needs. It names the account, never the data.
 */
export default async function ForbiddenPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const from = safeNextPath(Array.isArray(sp.from) ? sp.from[0] : sp.from, "");
  const staff = await currentStaff();
  const home = staff ? staffHome(staff) : "/login";

  return (
    <main className="min-h-dvh bg-cream px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <Link href="/" aria-label="Home" className="inline-block">
          <Logo />
        </Link>
        <h1 className="mt-8 font-display text-3xl text-ink-900">That page isn&apos;t for your account</h1>
        <p className="mt-3 text-ink-500">
          {staff ? (
            <>
              You&apos;re signed in as <strong className="text-ink-900">{staff.name}</strong> (
              {staff.roles.map((r) => ROLE_LABEL[r]).join(", ") || "no role yet"}
              {staff.external ? ", subcontractor" : ""}). If you need it, ask an admin to change your role.
            </>
          ) : (
            "You're not signed in."
          )}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            href={home}
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-accent-700 px-6 py-3 font-semibold text-white transition hover:bg-accent-800"
          >
            {staff ? "Go to my work" : "Sign in"}
          </Link>
          {staff && (
            <form action="/auth/logout" method="post" className="flex-1">
              <input type="hidden" name="next" value={from ? `/login?next=${encodeURIComponent(from)}` : "/login"} />
              <button
                type="submit"
                className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-line bg-white px-6 py-3 font-semibold text-ink-900 transition hover:border-ink-300"
              >
                Switch account
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
