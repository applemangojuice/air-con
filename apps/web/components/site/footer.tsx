import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getPublicSettings } from "@/lib/public-settings";
import { fgasClaim } from "./claims";
import { Logo } from "./logo";

/** Deliberately succinct: the pages that matter, and a way to reach us. */
const links = [
  { label: "Get my price", href: "/quote" },
  { label: "What it costs", href: "/guides/air-conditioning-cost-uk" },
  { label: "FAQ", href: "/faq" },
  { label: "About us", href: "/about" },
  { label: "Where we install", href: "/areas" },
];

const legalLinks = [
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Analytics choices", href: "/privacy#analytics" },
];

/**
 * The site footer. Company details and any certification line come from
 * settings, so it only ever states what's held (no "F-gas certified" until
 * the company certificate is recorded, no finance line at all).
 */
export async function SiteFooter() {
  const settings = await getPublicSettings();
  const c = settings.company;
  const fgas = fgasClaim(settings);
  const identity = [
    c.legalName,
    c.companyNumber ? `Registered in England and Wales, company no. ${c.companyNumber}` : null,
    c.registeredAddress ? `Registered office: ${c.registeredAddress}` : null,
    c.vatNumber ? `VAT no. ${c.vatNumber}` : null,
  ].filter(Boolean);

  return (
    <footer className="ink-gradient mt-auto text-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div>
            <Logo dark />
            <p className="mt-3 max-w-xs text-sm text-white/75">
              Heat pumps that cool your home in summer and warm it in winter. {BRAND.strap}.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-white/80 sm:flex sm:flex-wrap sm:items-center sm:gap-x-6">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="py-1 hover:text-white hover:underline">
                {l.label}
              </Link>
            ))}
            <a href={`mailto:${c.email}`} className="col-span-2 py-1 hover:text-white hover:underline">
              {c.email}
            </a>
          </nav>
        </div>
        {settings.serviceArea.length > 0 && (
          <p className="mt-8 text-xs text-white/75">
            <span className="font-semibold text-white/85">Where we install: </span>
            {settings.serviceArea.slice().sort((a, b) => a.localeCompare(b, "en", { numeric: true })).join(" · ")}
          </p>
        )}
        <div className="mt-8 flex flex-wrap items-end justify-between gap-4 border-t border-white/15 pt-6 text-xs text-white/75">
          <div className="space-y-1">
            <p>
              © {new Date().getFullYear()} {identity.join(". ")}.
            </p>
            {fgas && <p>{fgas}</p>}
          </div>
          <nav aria-label="Legal" className="flex gap-4">
            {legalLinks.map((l) => (
              <Link key={l.href} href={l.href} className="py-1 hover:text-white hover:underline">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
