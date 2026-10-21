import Link from "next/link";

/**
 * Prototype-only nav strip at the very bottom of every page: one place to hop
 * between the customer journey and the staff tools while we build. The root
 * layout renders it only outside production, or in production when
 * settings.features.showPrototypeNav is switched on (lib/public-settings.ts).
 * Staff pages still check sign-in themselves; these are just links.
 */

const GROUPS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Customer",
    links: [
      { label: "Home", href: "/" },
      { label: "Get a price", href: "/quote" },
      { label: "Project (demo)", href: "/p/demo" },
      { label: "Portal", href: "/portal" },
      { label: "Where we install", href: "/areas" },
      { label: "Terms", href: "/terms" },
    ],
  },
  {
    title: "Staff",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Ops", href: "/ops" },
      { label: "Field", href: "/field" },
      { label: "Quote requests", href: "/ops/quotes" },
    ],
  },
];

export function PrototypeNav() {
  return (
    <nav aria-label="Prototype pages" className="no-print border-t border-line bg-surface px-4 py-3 text-xs sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-semibold uppercase tracking-wide text-ink-500">Prototype</span>
        {GROUPS.map((group) => (
          <span key={group.title} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-semibold text-ink-700">{group.title}:</span>
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-ink-700 underline-offset-2 hover:text-ink-900 hover:underline"
              >
                {link.label}
              </Link>
            ))}
          </span>
        ))}
      </div>
    </nav>
  );
}
