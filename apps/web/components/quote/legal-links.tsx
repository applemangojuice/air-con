/**
 * Terms and privacy, on every funnel step and every result. They open in a
 * new tab so nobody loses their place in the quote to read them.
 */
export function LegalLinks({ className = "" }: { className?: string }) {
  const link =
    "font-medium text-ink-700 underline decoration-line underline-offset-2 hover:text-ink-900 hover:decoration-ink-500";
  return (
    <p className={`no-print text-center text-xs text-ink-500 ${className}`.trim()}>
      <a href="/terms" target="_blank" rel="noopener" className={link}>
        Terms<span className="sr-only"> (opens in a new tab)</span>
      </a>
      <span aria-hidden className="mx-2">
        ·
      </span>
      <a href="/privacy" target="_blank" rel="noopener" className={link}>
        Privacy<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </p>
  );
}
