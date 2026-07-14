import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Logo } from "./logo";

const columns = [
  {
    title: "Customers",
    links: [
      { label: "Get a fixed price", href: "/quote" },
      { label: "How it works", href: "/how-it-works" },
      { label: "Customer portal", href: "/portal" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Operations", href: "/ops" },
      { label: "Design studio", href: "/ops#design" },
      { label: "Installer app", href: "/ops#installer" },
      { label: "Monitoring", href: "/ops#monitoring" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: `Email: ${BRAND.supportEmail}`, href: `mailto:${BRAND.supportEmail}` },
      { label: `Call: ${BRAND.phoneDisplay}`, href: "#" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="ink-gradient mt-auto text-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo dark />
            <p className="mt-3 max-w-xs text-sm text-white/60">{BRAND.tagline}</p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-white/80">{col.title}</h3>
              <ul className="mt-3 space-y-2 text-sm text-white/60">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-12 border-t border-white/10 pt-6 text-xs text-white/40">
          © {new Date().getFullYear()} {BRAND.legalName}. All installations by F-Gas certified
          engineers. Finance figures are illustrative until a lender is connected.
        </p>
      </div>
    </footer>
  );
}
