import { BRAND } from "@/lib/brand";

/**
 * The Dang, It's Hot wordmark: ink "Dang," with "It's Hot" in flame orange,
 * snowflake badge up front. Matches the collateral in public/brand/.
 */
export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
        <rect width="26" height="26" rx="8" className={dark ? "fill-accent-400" : "fill-accent-600"} />
        {/* snowflake */}
        <path
          d="M13 6v14M6.9 9.5l12.2 7M19.1 9.5l-12.2 7M13 6l-1.8-1.8M13 6l1.8-1.8M13 20l-1.8 1.8M13 20l1.8 1.8M6.9 9.5 4.4 9M6.9 9.5 6.4 7M19.1 16.5l2.5.5M19.1 16.5l.5 2.5M19.1 9.5l2.5-.5M19.1 9.5l.5-2.5M6.9 16.5l-2.5.5M6.9 16.5l-.5 2.5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="whitespace-nowrap text-lg font-display leading-none">
        <span className={dark ? "text-white" : "text-ink-900"}>{BRAND.nameLead} </span>
        <span className={dark ? "text-accent-400" : "text-accent-600"}>{BRAND.nameHot}</span>
      </span>
    </span>
  );
}
