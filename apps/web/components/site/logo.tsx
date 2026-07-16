import { BRAND } from "@/lib/brand";

/**
 * The Dang, It's Hot square mark + two-tone wordmark. Same artwork as
 * app/icon.svg (the favicon): ink tile, white D, hot orange spark,
 * splash-blue swash. Matches the collateral in public/brand/.
 */
export function Mark({ size = 26, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      {/* on dark panels the tile lifts a step so it doesn't melt into the bg */}
      <rect width="64" height="64" rx="16" fill={dark ? "#2b3040" : "#1d212b"} />
      <path
        d="M14 15h14c11.6 0 19 6.6 19 17s-7.4 17-19 17H14Zm9.5 8v18h4.2c6.2 0 10.5-3.4 10.5-9s-4.3-9-10.5-9Z"
        fill="#f8f5ef"
      />
      <path
        d="M52.5 14.5c1.5 0 2.6 1 2.6 2.5 0 3.4-1 12.6-2.6 12.6S49.9 20.4 49.9 17c0-1.5 1.1-2.5 2.6-2.5Z"
        className="fill-accent-500"
      />
      <circle cx="52.5" cy="35.5" r="3.2" className="fill-accent-500" />
      <path
        d="M45 43c2.6 2.2 5.4 3.3 9.4 3.1-1.2 3.4-4.2 5.4-7.6 4.9-2.9-.4-4.9-2.6-5-5.3-.1-1.4 1.2-2.7 3.2-2.7Z"
        className="fill-sage-500"
        opacity="0.9"
      />
    </svg>
  );
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <Mark dark={dark} />
      <span className="whitespace-nowrap text-lg font-display leading-none">
        <span className={dark ? "text-white" : "text-ink-900"}>{BRAND.nameLead} </span>
        <span className={dark ? "text-accent-400" : "text-accent-600"}>{BRAND.nameHot}</span>
      </span>
    </span>
  );
}
