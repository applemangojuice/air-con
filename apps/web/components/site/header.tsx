import Link from "next/link";
import { Logo } from "./logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2 text-sm font-medium text-ink-700">
          <Link href="/how-it-works" className="hidden sm:block rounded-lg px-3 py-2 hover:bg-mist">
            How it works
          </Link>
          <Link href="/portal" className="hidden sm:block rounded-lg px-3 py-2 hover:bg-mist">
            My account
          </Link>
          <Link
            href="/quote"
            className="rounded-xl bg-air-600 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-air-700"
          >
            Get my price
          </Link>
        </nav>
      </div>
    </header>
  );
}
