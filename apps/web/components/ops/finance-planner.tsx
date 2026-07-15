"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PLAN_SCENARIOS,
  buildPlan,
  type PlanAssumptions,
} from "@aircon/domain";
import { gbp } from "@/lib/format";
import { SeedCase } from "./seed-case";

type ScenarioId = keyof typeof PLAN_SCENARIOS;
const STORAGE_KEY = "dih.finance-plan.v1";

/**
 * The P&L planner. Assumptions on the left, the plan recomputed live on
 * every keystroke through the pure domain model. Custom tweaks persist to
 * this browser; scenarios reset them.
 */
export function FinancePlanner() {
  const [scenario, setScenario] = useState<ScenarioId>("base");
  const [a, setA] = useState<PlanAssumptions>(PLAN_SCENARIOS.base);

  // Restore a saved custom plan once.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { scenario: ScenarioId; a: PlanAssumptions };
        setScenario(saved.scenario);
        setA({ ...PLAN_SCENARIOS[saved.scenario], ...saved.a });
      }
    } catch {
      /* fresh start */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ scenario, a }));
    } catch {
      /* private mode */
    }
  }, [scenario, a]);

  const plan = useMemo(() => buildPlan(a), [a]);
  const set = (update: Partial<PlanAssumptions>) => setA((prev) => ({ ...prev, ...update }));

  function pickScenario(id: ScenarioId) {
    setScenario(id);
    setA(PLAN_SCENARIOS[id]);
  }

  function downloadCsv() {
    const header =
      "month,installs,crews,letters,revenue,cogs,gross_profit,marketing,opex,ebitda,cash";
    const rows = plan.months.map((m) =>
      [
        m.month,
        m.installs,
        m.crews,
        m.lettersMailed,
        m.revenueGbp,
        m.cogsGbp,
        m.grossProfitGbp,
        m.marketingGbp,
        m.opexGbp,
        m.ebitdaGbp,
        m.cashGbp,
      ].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pnl-${scenario}-${a.months}m.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const s = plan.summary;

  return (
    <div className="space-y-6">
      {/* Scenario picker */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PLAN_SCENARIOS) as ScenarioId[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => pickScenario(id)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold capitalize transition ${
              scenario === id
                ? "border-accent-600 bg-accent-50 text-accent-700"
                : "border-line bg-white text-ink-700 hover:border-ink-300"
            }`}
          >
            {id}
          </button>
        ))}
        <span className="text-xs text-ink-300">
          Pick a scenario, then tweak anything. Your tweaks stay in this browser.
        </span>
        <button
          type="button"
          onClick={downloadCsv}
          className="ml-auto rounded-full border border-line px-4 py-1.5 text-sm font-semibold text-ink-700 transition hover:bg-surface"
        >
          Download P&L CSV
        </button>
      </div>

      {/* The headline: what to raise and when it pays back */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="The raise"
          value={s.fundingNeedGbp ? gbp(s.fundingNeedGbp) : "Self-funding"}
          hint={
            s.fundingNeedGbp
              ? `Cash trough ${gbp(s.cashTrough.amountGbp)} in month ${s.cashTrough.month}, plus 25% buffer`
              : "Never goes cash-negative on these numbers"
          }
          highlight
        />
        <Stat
          label="Monthly breakeven"
          value={s.breakevenMonth ? `Month ${s.breakevenMonth}` : "Not in horizon"}
          hint={s.breakevenMonth ? "First month EBITDA turns positive" : "Push growth or cut costs"}
          alert={!s.breakevenMonth}
        />
        <Stat
          label="Year 1"
          value={gbp(s.year1.revenueGbp)}
          hint={`${s.year1.installs} installs · EBITDA ${gbp(s.year1.ebitdaGbp)}`}
        />
        <Stat
          label="Year 2"
          value={gbp(s.year2.revenueGbp)}
          hint={`${s.year2.installs} installs · EBITDA ${gbp(s.year2.ebitdaGbp)} · ${s.maxCrews} crews by the end`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Assumptions: every cost is a dial */}
        <div className="space-y-4">
          <Group title="Demand">
            <Num label="Installs in month 1" value={a.installsMonth1} onChange={(v) => set({ installsMonth1: v })} />
            <Num label="Growth per month %" value={a.monthlyGrowthPct} onChange={(v) => set({ monthlyGrowthPct: v })} />
            <Num label="Installs per crew / month" value={a.installsPerCrewPerMonth} onChange={(v) => set({ installsPerCrewPerMonth: v })} />
            <Num label="Horizon (months)" value={a.months} onChange={(v) => set({ months: Math.max(6, Math.min(48, v)) })} />
          </Group>
          <Group title="Per install">
            <Num label="Average order value £" value={a.avgOrderValueGbp} onChange={(v) => set({ avgOrderValueGbp: v })} />
            <Num label="Kit cost £" value={a.kitCostGbp} onChange={(v) => set({ kitCostGbp: v })} />
            <Num label="Labour £" value={a.labourCostGbp} onChange={(v) => set({ labourCostGbp: v })} />
            <Num label="Courier £" value={a.courierCostGbp} onChange={(v) => set({ courierCostGbp: v })} />
            <Num label="Other direct £" value={a.otherDirectGbp} onChange={(v) => set({ otherDirectGbp: v })} />
          </Group>
          <Group title="Getting customers (mailing)">
            <Num label="Cost per letter £" value={a.mailCostGbp} step={0.05} onChange={(v) => set({ mailCostGbp: v })} />
            <Num label="Response rate %" value={a.responseRatePct} step={0.1} onChange={(v) => set({ responseRatePct: v })} />
            <Num label="Quote → install %" value={a.quoteToInstallPct} onChange={(v) => set({ quoteToInstallPct: v })} />
          </Group>
          <Group title="Overheads / month">
            <Num label="Founder draw £" value={a.founderDrawGbp} onChange={(v) => set({ founderDrawGbp: v })} />
            <Num label="Fixed opex £" value={a.opexMonthlyGbp} onChange={(v) => set({ opexMonthlyGbp: v })} />
            <Num label="Each extra crew £" value={a.extraCrewMonthlyGbp} onChange={(v) => set({ extraCrewMonthlyGbp: v })} />
          </Group>
          <Group title="One-offs">
            <Num label="Setup costs £" value={a.setupCostsGbp} onChange={(v) => set({ setupCostsGbp: v })} />
            <Num label="Starting cash £" value={a.startingCashGbp} onChange={(v) => set({ startingCashGbp: v })} />
            <p className="text-xs text-ink-300">
              Setup covers the van, tools, initial stock and brand, hitting month 1.
            </p>
          </Group>
        </div>

        {/* Outputs */}
        <div className="space-y-6">
          {/* Unit economics */}
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-bold">One install, unit economics</h2>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
              <Fact k="Revenue" v={gbp(plan.unit.revenueGbp)} />
              <Fact k="Kit" v={`-${gbp(plan.unit.kitGbp)}`} />
              <Fact k="Labour" v={`-${gbp(plan.unit.labourGbp)}`} />
              <Fact k="Courier" v={`-${gbp(plan.unit.courierGbp)}`} />
              <Fact k="Other" v={`-${gbp(plan.unit.otherGbp)}`} />
              <Fact k="Gross profit" v={`${gbp(plan.unit.grossProfitGbp)} (${plan.unit.grossMarginPct}%)`} strong />
              <Fact k="CAC (letters)" v={`-${gbp(plan.unit.cacGbp)}`} />
              <Fact k="Contribution" v={gbp(plan.unit.contributionGbp)} strong />
            </div>
          </section>

          {/* Cash curve */}
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="font-bold">Cash in the bank, month by month</h2>
            <p className="mt-1 text-xs text-ink-500">
              The deepest point is the money you need to have raised before you start.
            </p>
            <CashChart plan={plan} />
          </section>

          {/* Monthly P&L table */}
          <section className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface text-right text-xs font-semibold text-ink-500">
                  <th className="px-3 py-2.5 text-left">Month</th>
                  <th className="px-3 py-2.5">Installs</th>
                  <th className="px-3 py-2.5">Letters</th>
                  <th className="px-3 py-2.5">Revenue</th>
                  <th className="px-3 py-2.5">Gross profit</th>
                  <th className="px-3 py-2.5">Marketing</th>
                  <th className="px-3 py-2.5">Opex</th>
                  <th className="px-3 py-2.5">EBITDA</th>
                  <th className="px-3 py-2.5">Cash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {plan.months.map((m) => (
                  <tr
                    key={m.month}
                    className={`text-right tabular-nums ${
                      m.month === s.breakevenMonth ? "bg-sage-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2 text-left font-medium">
                      M{m.month}
                      {m.month === s.breakevenMonth && (
                        <span className="ml-1.5 text-xs font-semibold text-sage-700">breakeven</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{m.installs}</td>
                    <td className="px-3 py-2 text-ink-500">{m.lettersMailed.toLocaleString("en-GB")}</td>
                    <td className="px-3 py-2">{gbp(m.revenueGbp)}</td>
                    <td className="px-3 py-2">{gbp(m.grossProfitGbp)}</td>
                    <td className="px-3 py-2 text-ink-500">{gbp(m.marketingGbp)}</td>
                    <td className="px-3 py-2 text-ink-500">{gbp(m.opexGbp)}</td>
                    <td className={`px-3 py-2 font-semibold ${m.ebitdaGbp < 0 ? "text-red-600" : "text-sage-700"}`}>
                      {gbp(m.ebitdaGbp)}
                    </td>
                    <td className={`px-3 py-2 font-semibold ${m.cashGbp < 0 ? "text-red-600" : ""}`}>
                      {gbp(m.cashGbp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* The investment story, auto-written from the numbers */}
          <section className="rounded-2xl border border-accent-100 bg-accent-50/50 p-5 text-sm leading-relaxed text-ink-700">
            <h2 className="font-bold text-ink-900">The ask, in one paragraph</h2>
            <p className="mt-2">
              {s.fundingNeedGbp ? (
                <>
                  Raising <strong>{gbp(s.fundingNeedGbp)}</strong> covers {gbp(a.setupCostsGbp)} of
                  setup (van, tools, stock, brand) and carries the plan through its cash trough of{" "}
                  {gbp(Math.abs(s.cashTrough.amountGbp))} in month {s.cashTrough.month}, with a 25%
                  buffer.{" "}
                </>
              ) : (
                <>On these numbers the plan self-funds from month one. </>
              )}
              {s.breakevenMonth ? (
                <>
                  The business turns monthly-profitable in <strong>month {s.breakevenMonth}</strong>
                  {", "}
                </>
              ) : (
                <>The business does not reach monthly breakeven inside this horizon, </>
              )}
              reaching {s.year2.installs} installs and {gbp(s.year2.revenueGbp)} revenue in year
              two at a {plan.unit.grossMarginPct}% gross margin, run by {s.maxCrews} crew
              {s.maxCrews === 1 ? "" : "s"}. Acquisition stays direct:{" "}
              {s.totalLetters.toLocaleString("en-GB")} addressed letters over the plan at{" "}
              {gbp(plan.unit.cacGbp)} per won install, driven by the property intelligence engine.
            </p>
          </section>
        </div>
      </div>

      <SeedCase plan={plan} a={a} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cash curve: single series, zero line, hover tooltip                 */
/* ------------------------------------------------------------------ */

function CashChart({ plan }: { plan: ReturnType<typeof buildPlan> }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const PAD = { top: 16, right: 12, bottom: 24, left: 56 };

  const months = plan.months;
  const values = months.map((m) => m.cashGbp);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const x = (i: number) =>
    PAD.left + (i / Math.max(1, months.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((max - v) / span) * (H - PAD.top - PAD.bottom);

  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const troughIdx = months.findIndex((m) => m.month === plan.summary.cashTrough.month);
  const breakevenIdx = plan.summary.breakevenMonth
    ? months.findIndex((m) => m.month === plan.summary.breakevenMonth)
    : -1;

  const compact = (v: number) =>
    `${v < 0 ? "-" : ""}£${Math.abs(v) >= 1000 ? `${Math.round(Math.abs(v) / 1000)}k` : Math.abs(v)}`;

  return (
    <div className="relative -mx-1 overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="min-w-[560px]"
        role="img"
        aria-label="Cumulative cash by month"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(
            ((px - PAD.left) / (W - PAD.left - PAD.right)) * (months.length - 1),
          );
          setHover(Math.max(0, Math.min(months.length - 1, i)));
        }}
      >
        {/* zero line + axis labels: recessive */}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#ddcdae" strokeDasharray="4 4" />
        <text x={PAD.left - 8} y={y(0) + 4} textAnchor="end" fontSize="11" fill="#a89e90">
          £0
        </text>
        <text x={PAD.left - 8} y={y(max) + 4} textAnchor="end" fontSize="11" fill="#a89e90">
          {compact(max)}
        </text>
        {min < 0 && (
          <text x={PAD.left - 8} y={y(min) + 4} textAnchor="end" fontSize="11" fill="#a89e90">
            {compact(min)}
          </text>
        )}
        <text x={x(0)} y={H - 6} textAnchor="middle" fontSize="11" fill="#a89e90">
          M1
        </text>
        <text x={x(months.length - 1)} y={H - 6} textAnchor="middle" fontSize="11" fill="#a89e90">
          M{months.length}
        </text>

        {/* the line */}
        <path d={path} fill="none" stroke="#aa5a29" strokeWidth="2" strokeLinejoin="round" />

        {/* trough + breakeven markers, directly labeled */}
        {troughIdx >= 0 && (
          <g>
            <circle cx={x(troughIdx)} cy={y(values[troughIdx]!)} r="4.5" fill="#aa5a29" stroke="#fff" strokeWidth="2" />
            <text x={x(troughIdx)} y={y(values[troughIdx]!) + 18} textAnchor="middle" fontSize="11" fontWeight="600" fill="#4a4540">
              trough {compact(values[troughIdx]!)}
            </text>
          </g>
        )}
        {breakevenIdx >= 0 && (
          <g>
            <circle cx={x(breakevenIdx)} cy={y(values[breakevenIdx]!)} r="4.5" fill="#7a8a5e" stroke="#fff" strokeWidth="2" />
            <text x={x(breakevenIdx)} y={y(values[breakevenIdx]!) - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="#57633f">
              breakeven
            </text>
          </g>
        )}

        {/* hover crosshair + tooltip */}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="#a89e90" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(values[hover]!)} r="4" fill="#aa5a29" stroke="#fff" strokeWidth="2" />
            {(() => {
              const boxW = 168;
              const bx = Math.min(W - PAD.right - boxW, Math.max(PAD.left, x(hover) - boxW / 2));
              const by = PAD.top;
              const m = months[hover]!;
              return (
                <g>
                  <rect x={bx} y={by} width={boxW} height={54} rx="8" fill="#201e1d" opacity="0.92" />
                  <text x={bx + 10} y={by + 17} fontSize="11" fontWeight="600" fill="#fff">
                    Month {m.month} · {m.installs} installs
                  </text>
                  <text x={bx + 10} y={by + 32} fontSize="11" fill="#f4dcc2">
                    Cash {compact(m.cashGbp)}
                  </text>
                  <text x={bx + 10} y={by + 46} fontSize="11" fill="#f4dcc2">
                    EBITDA {compact(m.ebitdaGbp)}
                  </text>
                </g>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-3 space-y-2.5">{children}</div>
    </section>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-500">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-24 rounded-xl border border-line bg-white px-2.5 py-1.5 text-right text-sm tabular-nums outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
    </label>
  );
}

function Fact({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <p className="flex justify-between gap-3">
      <span className="text-ink-500">{k}</span>
      <span className={strong ? "font-bold" : "font-medium"}>{v}</span>
    </p>
  );
}

function Stat({
  label,
  value,
  hint,
  highlight,
  alert,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        highlight
          ? "border-accent-400 bg-accent-50/60"
          : alert
            ? "border-red-300 bg-red-50"
            : "border-line"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className={`mt-1 text-2xl font-display ${alert ? "text-red-600" : ""}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
