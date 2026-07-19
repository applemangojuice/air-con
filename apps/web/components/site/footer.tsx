import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Logo } from "./logo";

/** Deliberately succinct: the pages that matter, and a way to reach us. */
const links = [
  { label: "Get my price", href: "/quote" },
  { label: "Our process", href: "/how-it-works" },
  { label: "FAQ", href: "/faq" },
  { label: "About us", href: "/about" },
];

const legalLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

export function SiteFooter() {
  return (
    <footer className="ink-gradient mt-auto text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <Logo dark />
            <p className="mt-3 max-w-xs text-sm text-white/60">{BRAND.tagline}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/70">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-white">
                {l.label}
              </Link>
            ))}
            <a href={`mailto:${BRAND.supportEmail}`} className="hover:text-white">
              {BRAND.supportEmail}
            </a>
          </nav>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-white/40">
          <p>
            © {new Date().getFullYear()} {BRAND.legalName}. All installations by F-Gas certified
            engineers. Finance figures are illustrative until a lender is connected.
          </p>
          <nav className="flex gap-4">
            {legalLinks.map((l) => (
              <Link key={l.href} href={l.href} className="hover:text-white/70">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
