import type { TermsSection } from "@aircon/domain";

/**
 * Our terms as frozen on a proposal (or a contract): numbered sections of
 * plain text, in a disclosure so the page stays readable, and printed open.
 * Server or client: no state of its own.
 */
export function TermsText({
  sections,
  version,
  open = false,
  summary,
}: {
  sections: TermsSection[];
  version: string;
  open?: boolean;
  summary?: string;
}) {
  return (
    <details open={open} className="group rounded-2xl border border-line bg-white print:border-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-ink-900 sm:px-6 [&::-webkit-details-marker]:hidden">
        {summary ?? `Read our terms (version ${version})`}
        <span aria-hidden className="text-ink-500 transition group-open:rotate-180 print:hidden">
          ▾
        </span>
      </summary>
      <div className="space-y-4 border-t border-line px-5 py-4 text-sm leading-relaxed text-ink-700 sm:px-6">
        {sections.map((section, i) => (
          <section key={section.id} aria-labelledby={`terms-${section.id}`}>
            <h4 id={`terms-${section.id}`} className="font-semibold text-ink-900">
              {i + 1}. {section.title}
            </h4>
            {section.items.length === 1 ? (
              <p className="mt-1 whitespace-pre-line">{section.items[0]}</p>
            ) : (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {section.items.map((item) => (
                  <li key={item} className="whitespace-pre-line">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </details>
  );
}
