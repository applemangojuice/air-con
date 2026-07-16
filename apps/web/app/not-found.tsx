import Link from "next/link";
import { Logo } from "@/components/site/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-cream px-4 text-center">
      <Logo />
      <p className="mt-8 text-6xl font-display">404</p>
      <h1 className="mt-3 text-2xl font-display">This page has gone missing</h1>
      <p className="mt-2 max-w-md text-ink-500">
        Unlike our installers, who turn up on the day they said, in writing. The page you wanted
        isn&apos;t here, but the cold air is close.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-full bg-accent-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-accent-700"
        >
          Back to the cool stuff
        </Link>
        <Link href="/quote" className="text-sm font-semibold text-accent-700 hover:underline">
          Or just get my price →
        </Link>
      </div>
    </div>
  );
}
