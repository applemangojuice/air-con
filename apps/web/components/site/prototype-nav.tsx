import Link from "next/link";

/**
 * Prototype-only nav strip, rendered at the very bottom of every page from
 * the root layout. One place to hop between the customer journey and the
 * admin console while the demo has no real accounts or role-based routing.
 * Delete this component (and its slot in app/layout.tsx) when auth lands.
 */

const GROUPS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Customer",
    links: [
      { label: "Home", href: "/" },
      { label: "Get a quote", href: "/quote" },
      { label: "Project timeline (demo)", href: "/p/demo" },
      { label: "Portal", href: "/portal" },
      { label: "How it works", href: "/how-it-works" },
    ],
  },
  {
    title: "Admin",
    links: [
      { label: "Console", href: "/ops" },
      { label: "Projects", href: "/ops/projects" },
      { label: "Quote requests", href: "/ops/quotes" },
    ],
  },
];

export function PrototypeNav() {
  return (
    <nav
      aria-label="Prototype pages"
      className="border-t border-line bg-surface/70 px-4 py-3 text-xs sm:px-6"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-semibold uppercase tracking-wide text-ink-300">Prototype</span>
        {GROUPS.map((group) => (
          <span key={group.title} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-semibold text-ink-500">{group.title}:</span>
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
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
