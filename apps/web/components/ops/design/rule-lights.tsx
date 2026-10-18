import type { RuleResult } from "@aircon/domain";
import { RULE_LIGHT } from "./labels";

/**
 * The rule lights with their evidence: anything blocked first, then what
 * wants a look, then the passes folded away. Pure; renders exactly what the
 * engine returned.
 */
export function RuleLights({ rules }: { rules: RuleResult[] }) {
  const fails = rules.filter((r) => r.status === "fail");
  const reviews = rules.filter((r) => r.status === "review");
  const passes = rules.filter((r) => r.status === "pass");
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {[...fails, ...reviews].map((r) => (
          <Light key={r.id} rule={r} />
        ))}
      </ul>
      {passes.length > 0 && (
        <details className="group rounded-2xl border border-emerald-200 bg-emerald-50/50">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-emerald-800">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
            {passes.length} check{passes.length === 1 ? "" : "s"} pass
            <span aria-hidden className="ml-auto text-xs transition group-open:rotate-180">
              ▾
            </span>
          </summary>
          <ul className="space-y-2 px-2 pb-2">
            {passes.map((r) => (
              <Light key={r.id} rule={r} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Light({ rule }: { rule: RuleResult }) {
  const l = RULE_LIGHT[rule.status];
  return (
    <li className={`rounded-2xl border px-4 py-3 ${l.ring}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${l.dot}`} />
        <h4 className="text-sm font-semibold text-ink-900">{rule.title}</h4>
        <span className={`text-xs font-semibold uppercase tracking-wide ${l.text}`}>{l.label}</span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-700">{rule.detail}</p>
    </li>
  );
}
