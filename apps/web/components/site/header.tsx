import Link from "next/link";
import { Logo } from "./logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2 text-sm font-medium text-ink-700">
          <Link href="/about" className="rounded-full px-3 py-2 hover:bg-surface">
            Our story
          </Link>
          <Link href="/how-it-works" className="rounded-full px-3 py-2 hover:bg-surface">
            Our process
          </Link>
          <Link href="/faq" className="hidden rounded-full px-3 py-2 hover:bg-surface sm:block">
            FAQ
          </Link>
          <Link
            href="/quote"
            className="rounded-full bg-accent-600 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-accent-700"
          >
            Get my price
          </Link>
        </nav>
      </div>
    </header>
  );
}
