import { JOB_TARGETS, decayResultText, pressureDecayRows, vacuumDecayRows, type ChargeCheckView, type DecayTestView } from "@aircon/domain";

/**
 * A pressure or vacuum decay test as the readings decide it: the result,
 * why it failed and what to do, the readings exactly as taken and the
 * working (the temperature correction, the allowance, the rise and its
 * limit). On the runsheet step and the Commission tab.
 */

const TONE: Record<DecayTestView["result"], string> = {
  pass: "border-emerald-200 bg-emerald-50 text-emerald-900",
  fail: "border-red-300 bg-red-50 text-red-900",
  incomplete: "border-line bg-surface text-ink-900",
};

export function DecayPanel({ test, compact = false }: { test: DecayTestView; compact?: boolean }) {
  const rows = test.pressure ? pressureDecayRows(test.pressure) : test.vacuum ? vacuumDecayRows(test.vacuum) : [];
  const name = test.kind === "pressure" ? "Strength and tightness test" : "Vacuum decay test";
  return (
    <div role={test.result === "fail" ? "alert" : undefined} className={`rounded-xl border px-3 py-2 text-sm ${TONE[test.result]}`}>
      <p className="text-base font-semibold">
        {name}: {decayResultText(test)}
      </p>
      {test.fails.length > 0 && (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {test.fails.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {test.result === "fail" && test.retestNeeded && (
        <p className="mt-1 font-medium">
          Retest: take every reading again ({test.toTake.length === 0 ? "all of them" : `${test.toTake.length} still to take`}). Tapping Pass, or typing one reading again, doesn&apos;t clear a failed test.
        </p>
      )}
      {test.invalid.length > 0 && (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-amber-900">
          {test.invalid.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {test.pending.length > 0 && test.result !== "fail" && (
        <p className="mt-1 text-ink-700">
          Judged so far without the tech lead&apos;s {test.pending.map((k) => JOB_TARGETS[k].label.toLowerCase()).join("; ")}: set from the manual on the Commission tab, the readings are judged again.
        </p>
      )}
      {!compact && rows.length > 0 && (
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{k}</dt>
              <dd className="tabular-nums text-ink-900">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const CHARGE_TONE: Record<ChargeCheckView["result"], string> = {
  within: "border-emerald-200 bg-emerald-50 text-emerald-900",
  outside: "border-red-300 bg-red-50 text-red-900",
  incomplete: "border-line bg-surface text-ink-900",
};

/**
 * The charge step's check: what the as-built length needs (worked out from
 * the length typed and the catalogue's figures), next to what was weighed,
 * and whether it's inside the job's tolerance. Outside it, the tech lead
 * signs the weighed figure off with a reason on the Commission tab.
 */
export function ChargePanel({ check }: { check: ChargeCheckView }) {
  return (
    <div role={check.result === "outside" ? "alert" : undefined} className={`rounded-xl border px-3 py-2 text-sm ${CHARGE_TONE[check.result]}`}>
      <p className="text-base font-semibold">
        {check.result === "outside" ? "Charge: needs the tech lead's sign-off" : check.result === "within" ? "Charge: within tolerance" : "Charge against the as-built length"}
      </p>
      {check.expectedG !== undefined && (
        <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Expected</dt>
            <dd className="tabular-nums">{check.expectedG} g (± {check.toleranceG} g)</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Weighed</dt>
            <dd className="tabular-nums">{check.weighedG !== undefined ? `${check.weighedG} g` : "Not yet"}</dd>
          </div>
        </dl>
      )}
      <p className="mt-1">{check.words}</p>
    </div>
  );
}
