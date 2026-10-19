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
    <details open={open} className="group rounded-2xl border border-line bg-white p-4 text-sm print:border-0 print:p-0 [&[open]_summary]:mb-3">
      <summary className="cursor-pointer font-semibold text-ink-900 marker:text-ink-500">
        {summary ?? `Read our terms (version ${version})`}
      </summary>
      <div className="space-y-4 leading-relaxed text-ink-700">
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
