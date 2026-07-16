import { BRAND } from "@/lib/brand";

/**
 * The Dang, It's Hot lockup, drawn to match the collateral: a sticker-style
 * mark (ink tile, hot-orange brush swash, chunky D with a splash-blue offset
 * shadow, snowflake wink) and a brush-energy wordmark (caps "DANG," in ink
 * with "It's Hot" in orange script over a blue swash, the whole thing on a
 * slight tilt). The same Mark artwork ships as app/icon.svg.
 */
export function Mark({ size = 30, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill={dark ? "#2b3040" : "#1d212b"} />
      {/* hot-orange brush swash sweeping under the D */}
      <path
        d="M4 46c9 5 21 7.5 33 6.5 9.5-.8 17.5-3.6 23-8l1.6 6.2C55 56 46 59.4 36 60 24 60.7 12 58 4.8 52.6Z"
        fill="#f2711b"
      />
      <path d="M56.5 36.5c2.2-.8 4.4-1.8 6.3-3l.9 4.1c-2 1.3-4.3 2.4-6.6 3.2Z" fill="#f2711b" opacity="0.85" />
      {/* splash-blue offset shadow behind the D: the print/sticker look */}
      <g transform="rotate(-4 32 30)">
        <path
          d="M17.5 12.5h13c11.2 0 18.4 6.3 18.4 16.2S41.7 45 30.5 45h-13Zm9 7.6v17.2h3.8c5.9 0 10-3.2 10-8.6s-4.1-8.6-10-8.6Z"
          fill="#47698a"
          transform="translate(2.6 2.6)"
        />
        {/* the D itself, paper white */}
        <path
          d="M17.5 12.5h13c11.2 0 18.4 6.3 18.4 16.2S41.7 45 30.5 45h-13Zm9 7.6v17.2h3.8c5.9 0 10-3.2 10-8.6s-4.1-8.6-10-8.6Z"
          fill="#f8f5ef"
        />
      </g>
      {/* snowflake wink riding the swash */}
      <g stroke="#f8f5ef" strokeWidth="1.7" strokeLinecap="round">
        <path d="M49 47v8M45.6 49l6.8 4M52.4 49l-6.8 4" />
      </g>
    </svg>
  );
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <Mark dark={dark} />
      <span className="relative -rotate-2 whitespace-nowrap font-brand leading-none">
        <span className={`text-[17px] tracking-tight ${dark ? "text-white" : "text-ink-900"}`}>
          DANG,
        </span>{" "}
        <span
          className={`inline-block text-[17px] ${dark ? "text-accent-400" : "text-accent-500"}`}
          style={{ transform: "rotate(-2deg) translateY(-1px)" }}
        >
          It&apos;s Hot
        </span>
        {/* splash-blue swash under "It's Hot" */}
        <svg
          className="absolute -bottom-[5px] right-0 h-[6px] w-[62px]"
          viewBox="0 0 62 6"
          fill="none"
          aria-hidden
        >
          <path
            d="M1 4.5C12 1.5 30 .5 61 2.5c-14 .8-32 2.3-46 3z"
            fill={dark ? "#7d9cbb" : "#47698a"}
            opacity="0.85"
          />
        </svg>
      </span>
    </span>
  );
}
