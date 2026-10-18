import Link from "next/link";
import { Logo } from "./logo";

/**
 * The marketing header. The CTA is accent-700 so its white label passes AA
 * at this size; links keep a visible focus ring from globals.css.
 */
export function SiteHeader() {
  const link = "rounded-full px-3 py-2 hover:bg-surface";
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-cream/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" aria-label="Dang, It's Hot home page" className="shrink-0">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-0.5 text-sm font-medium text-ink-700 sm:gap-1">
          <Link href="/about" className={`hidden sm:block ${link}`}>
            About us
          </Link>
          <Link href="/guides/air-conditioning-cost-uk" className={`hidden md:block ${link}`}>
            Costs
          </Link>
          <Link href="/faq" className={link}>
            FAQ
          </Link>
          <Link
            href="/quote"
            className="ml-1 whitespace-nowrap rounded-full bg-accent-700 px-4 py-2 font-semibold text-white shadow-sm transition hover:brightness-90"
          >
            Get my price
          </Link>
        </nav>
      </div>
    </header>
  );
}
