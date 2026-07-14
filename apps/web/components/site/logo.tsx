import { BRAND } from "@/lib/brand";

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
        <rect width="26" height="26" rx="8" className={dark ? "fill-accent-400" : "fill-accent-600"} />
        <path
          d="M5.5 10.5h11a2.5 2.5 0 1 0-2.4-3.2M5.5 14.5h14a2.5 2.5 0 1 1-2.4 3.2M5.5 18.5h7"
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <span className={`text-lg font-display ${dark ? "text-white" : "text-ink-900"}`}>
        {BRAND.name}
      </span>
    </span>
  );
}
