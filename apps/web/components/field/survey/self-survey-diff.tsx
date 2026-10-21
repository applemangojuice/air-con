import { diffAccuracyPct, type SelfSurveyDiffRow } from "@aircon/domain";

/**
 * The customer's own survey against the surveyor's measurements, room by
 * room, with how often the customer was right. The pilot's most useful
 * number: does self-survey work, and where does it break?
 *
 * Server-safe (no hooks), so the ops command centre can render it from
 * `diffSelfSurvey(self, measured)` as it stands. Cards on a phone, a table
 * from `sm` up. Rows that can't be compared (the customer wasn't sure, or
 * it wasn't measured) are shown but don't count towards the score.
 */

function Verdict({ match }: { match: boolean | null }) {
  if (match === true)
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5l3 3 7-7" />
        </svg>
        Matched
      </span>
    );
  if (match === false)
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
          <path d="M4 8h8" />
        </svg>
        Different
      </span>
    );
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink-700">
      Can&apos;t compare
    </span>
  );
}

export function SelfSurveyDiff({
  rows,
  title = "Customer's survey vs what we measured",
  compact = false,
}: {
  rows: SelfSurveyDiffRow[];
  title?: string;
  /** Hide the explainer line (for tight spaces). */
  compact?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-line bg-white/60 px-5 py-6 text-center">
        <p className="font-semibold text-ink-900">Nothing to compare yet</p>
        <p className="mt-1 text-sm text-ink-500">The comparison appears once the survey has measurements and the customer&apos;s own survey is on file.</p>
      </section>
    );
  }
  const pct = diffAccuracyPct(rows);
  const compared = rows.filter((r) => r.match !== null);
  const right = compared.filter((r) => r.match === true).length;
  const tone = pct === null ? "text-ink-900" : pct >= 80 ? "text-emerald-800" : pct >= 50 ? "text-amber-800" : "text-red-700";

  return (
    <section aria-label={title} className="rounded-2xl border border-line bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h3 className="font-display text-lg text-ink-900">{title}</h3>
          {!compact && (
            <p className="mt-0.5 text-sm text-ink-500">How close the customer&apos;s own answers were. Rows that can&apos;t be compared don&apos;t count.</p>
          )}
        </div>
        <div className="text-right">
          <p className={`text-3xl font-semibold tabular-nums ${tone}`}>{pct === null ? "–" : `${pct}%`}</p>
          <p className="text-xs text-ink-500">
            {compared.length ? `${right} of ${compared.length} matched` : "No comparable answers yet"}
          </p>
        </div>
      </div>

      {/* Phone: one card per row */}
      <ul className="divide-y divide-line sm:hidden">
        {rows.map((r, i) => (
          <li key={`${r.room}-${r.field}-${i}`} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-sm font-semibold text-ink-900">
                {r.room} <span className="font-normal text-ink-500">· {r.field}</span>
              </p>
              <Verdict match={r.match} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-ink-500">Customer said</dt>
                <dd className="break-words text-ink-900">{r.customerSaid}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-ink-500">Measured</dt>
                <dd className="break-words text-ink-900">{r.measured}</dd>
              </div>
            </dl>
            {r.note && <p className="mt-1.5 text-xs text-ink-700">{r.note}</p>}
          </li>
        ))}
      </ul>

      {/* Wider: a table */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-500">
              <th scope="col" className="px-5 py-2.5 font-semibold">
                Where
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                What
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Customer said
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Measured
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-semibold">
                Result
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={`${r.room}-${r.field}-${i}`} className="align-top">
                <th scope="row" className="px-5 py-3 font-semibold text-ink-900">
                  {r.room}
                </th>
                <td className="px-3 py-3 text-ink-700">{r.field}</td>
                <td className="px-3 py-3 text-ink-900">{r.customerSaid}</td>
                <td className="px-3 py-3 text-ink-900">
                  {r.measured}
                  {r.note && <span className="mt-0.5 block text-xs text-ink-500">{r.note}</span>}
                </td>
                <td className="px-5 py-3 text-right">
                  <Verdict match={r.match} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default SelfSurveyDiff;
