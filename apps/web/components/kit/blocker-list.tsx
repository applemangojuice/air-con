import type { ReactNode } from "react";
import { GATE_LABEL, ROLE_LABEL, type Blocker, type StaffRole } from "@aircon/domain";

/**
 * What stands in the way, straight from the domain's gates: blocks first,
 * then warnings, each with whose move it is and what to do. Never invents
 * a blocker; renders exactly what `readiness` / `blockersFor` returned.
 */

function ownerLabel(owner: Blocker["owner"]): string {
  if (owner === "customer") return "Customer";
  if (owner === "ops") return "Ops";
  return ROLE_LABEL[owner as StaffRole] ?? owner;
}

export function BlockerList({
  blockers,
  showGate = false,
  empty,
  title,
}: {
  blockers: Blocker[];
  /** Prefix each item with its gate ("Ready to install"), for lists that span gates. */
  showGate?: boolean;
  /** Shown when there's nothing in the way. Default: a quiet all-clear. */
  empty?: ReactNode;
  title?: ReactNode;
}) {
  if (blockers.length === 0) {
    return empty === undefined ? (
      <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        Nothing in the way.
      </p>
    ) : (
      <>{empty}</>
    );
  }
  const groups: { severity: Blocker["severity"]; heading: string; items: Blocker[] }[] = [
    { severity: "block", heading: "Blocking", items: blockers.filter((b) => b.severity === "block") },
    { severity: "warn", heading: "Worth checking", items: blockers.filter((b) => b.severity === "warn") },
  ];
  return (
    <div className="space-y-4">
      {title && <h3 className="text-sm font-semibold text-ink-900">{title}</h3>}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => {
          const block = g.severity === "block";
          return (
            <div key={g.severity}>
              <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${block ? "text-red-700" : "text-amber-800"}`}>
                {g.heading} ({g.items.length})
              </p>
              <ul className="space-y-2">
                {g.items.map((b) => (
                  <li
                    key={`${b.gate}:${b.code}`}
                    className={`rounded-2xl border px-4 py-3 ${block ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}
                  >
                    <p className={`text-sm font-medium ${block ? "text-red-900" : "text-amber-900"}`}>
                      {showGate && <span className="font-semibold">{GATE_LABEL[b.gate]}: </span>}
                      {b.message}
                    </p>
                    <p className="mt-1 text-xs text-ink-700">
                      <span className="font-semibold">{ownerLabel(b.owner)}</span>
                      {b.action && <span> · {b.action}</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </div>
  );
}
