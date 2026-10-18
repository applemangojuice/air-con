import Link from "next/link";

/**
 * The job's own tabs: pack, the three days, commissioning, handover. Links,
 * not client state: each is its own page (the runsheet switches days
 * in-page, so it works without signal once loaded).
 */

export type JobTab = "pack" | "day" | "commissioning" | "handover";

export function JobNav({ projectId, active, day, days = 3 }: { projectId: string; active: JobTab; day?: number; days?: number }) {
  const base = `/field/jobs/${projectId}`;
  const items: { key: string; href: string; label: string; on: boolean }[] = [
    { key: "pack", href: base, label: "Job pack", on: active === "pack" },
    ...Array.from({ length: days }, (_, i) => ({ key: `day-${i + 1}`, href: `${base}/day/${i + 1}`, label: `Day ${i + 1}`, on: active === "day" && day === i + 1 })),
    { key: "commissioning", href: `${base}/commissioning`, label: "Commission", on: active === "commissioning" },
    { key: "handover", href: `${base}/handover`, label: "Handover", on: active === "handover" },
  ];
  return (
    <nav aria-label="This job" className="-mx-4 mb-5 overflow-x-auto px-4">
      <ul className="flex w-max gap-2">
        {items.map((i) => (
          <li key={i.key}>
            <Link
              href={i.href}
              aria-current={i.on ? "page" : undefined}
              className={`flex min-h-11 items-center rounded-full border px-4 text-base font-semibold ${i.on ? "border-ink-900 bg-ink-900 text-white" : "border-line bg-white text-ink-900 hover:bg-surface"}`}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
