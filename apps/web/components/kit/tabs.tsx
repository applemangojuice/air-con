import Link from "next/link";

export interface TabItem {
  href: string;
  label: string;
  count?: number;
}

/**
 * Link tabs: each tab is a URL, so tabs are shareable and work without
 * JavaScript. The page says which one is current (no pathname guessing);
 * the current tab carries aria-current="page". Scrolls sideways on phones.
 */
export function Tabs({ tabs, current, label = "Sections" }: { tabs: TabItem[]; current: string; label?: string }) {
  return (
    <nav aria-label={label} className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((t) => {
          const active = t.href === current;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition ${
                  active ? "border-accent-600 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900"
                }`}
              >
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${active ? "bg-accent-50 text-accent-700" : "bg-surface text-ink-700"}`}
                  >
                    {t.count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
