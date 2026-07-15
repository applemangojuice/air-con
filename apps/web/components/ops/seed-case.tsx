"use client";

import { useEffect, useMemo, useState } from "react";
import {
  INVESTOR_BASE,
  buildMilestones,
  ltvModel,
  marketModel,
  roundModel,
  sensitivity,
  type InvestorAssumptions,
  type MilestoneProof,
  type Plan,
  type PlanAssumptions,
} from "@aircon/domain";
import { gbp } from "@/lib/format";

const STORAGE_KEY = "dih.investor-case.v1";

const PROOF_STYLE: Record<MilestoneProof, { label: string; cls: string }> = {
  product: { label: "proves the product", cls: "bg-accent-100 text-accent-700" },
  market: { label: "proves the market", cls: "bg-sage-100 text-sage-700" },
  economics: { label: "proves the economics", cls: "bg-amber-50 text-amber-700" },
  execution: { label: "proves execution", cls: "bg-surface text-ink-700" },
  scale: { label: "proves scale", cls: "bg-ink-900 text-white" },
};

const compact = (v: number) => {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}£${(abs / 1_000_000_000).toFixed(1)}bn`;
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1000)}k`;
  return `${sign}£${abs}`;
};

/**
 * The seed case: market sizing, LTV:CAC, the round, sensitivity and the
 * goal timeline, all derived live from the same plan the P&L uses.
 */
export function SeedCase({ plan, a }: { plan: Plan; a: PlanAssumptions }) {
  const [inv, setInv] = useState<InvestorAssumptions>(INVESTOR_BASE);
  const [raise, setRaise] = useState<number | null>(null); // null = follow the plan's ask

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { inv: InvestorAssumptions; raise: number | null };
        setInv({ ...INVESTOR_BASE, ...saved.inv });
        setRaise(saved.raise);
      }
    } catch {
      /* fresh start */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ inv, raise }));
    } catch {
      /* private mode */
    }
  }, [inv, raise]);

  const set = (update: Partial<InvestorAssumptions>) =>
    setInv((prev) => ({ ...prev, ...update }));

  const ltv = useMemo(() => ltvModel(a, inv), [a, inv]);
  const market = useMemo(() => marketModel(a, inv, plan), [a, inv, plan]);
  const effectiveRaise = raise ?? Math.max(plan.summary.fundingNeedGbp, 0);
  const round = useMemo(() => roundModel(effectiveRaise, inv), [effectiveRaise, inv]);
  const rows = useMemo(() => sensitivity(a), [a]);
  const milestones = useMemo(() => buildMilestones(plan, a, inv), [plan, a, inv]);
  const maxAskDelta = Math.max(
    1,
    ...rows.flatMap((r) => [Math.abs(r.askDeltaLowGbp), Math.abs(r.askDeltaHighGbp)]),
  );

  return (
    <div className="mt-10 space-y-6">
      <div>
        <h2 className="text-xl font-display">The seed case</h2>
        <p className="mt-1 text-sm text-ink-500">
          Everything below recomputes from the plan above: change an assumption up there and the
          market share, ratios and milestone dates move down here.
        </p>
      </div>

      {/* Market: bottom-up TAM / SAM / SOM */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="font-bold">How big is this? (bottom-up)</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <MarketCard
            label="TAM · UK suitable homes"
            value={compact(market.tamGbp)}
            hint={`${(inv.tamHouseholds / 1_000_000).toFixed(1)}m homes × ${gbp(a.avgOrderValueGbp)}`}
          />
          <MarketCard
            label="SAM · South London"
            value={compact(market.samGbp)}
            hint={`${Math.round(inv.samHouseholds / 1000)}k suitable homes`}
          />
          <MarketCard
            label={`SOM · this ${a.months}-month plan`}
            value={compact(market.somGbp)}
            hint={`${market.somInstalls.toLocaleString("en-GB")} installs · ${market.beachheadPenetrationPct}% of the SW16/17 beachhead`}
            strong
          />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
          <Num label="Beachhead homes (SW16+17)" value={inv.beachheadHouseholds} onChange={(v) => set({ beachheadHouseholds: v })} />
          <Num label="South London homes" value={inv.samHouseholds} onChange={(v) => set({ samHouseholds: v })} />
          <Num label="UK suitable homes" value={inv.tamHouseholds} onChange={(v) => set({ tamHouseholds: v })} />
        </div>
        <p className="mt-2 text-xs text-ink-300">
          Sized from suitable owner-occupied houses, not raw addresses. The credibility check is
          the beachhead share: staying in single digits keeps the plan defensible.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LTV & CAC */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h3 className="font-bold">LTV : CAC</h3>
          <p className="mt-2 text-3xl font-display">
            {ltv.ltvToCac}:1{" "}
            <span className="text-base text-ink-500">
              (first install alone repays CAC {ltv.cacCoverage}×)
            </span>
          </p>
          <div className="mt-3 space-y-1.5 text-sm">
            <Fact k="Install contribution" v={gbp(ltv.installContributionGbp)} />
            <Fact k={`Service plan (${inv.servicePlanAttachPct}% attach, ${inv.servicePlanYears} yrs)`} v={`+${gbp(ltv.serviceLtvGbp)}`} />
            <Fact k="Blended LTV" v={gbp(ltv.blendedLtvGbp)} strong />
            <Fact k={`CAC after ${inv.referralPct}% referrals`} v={gbp(ltv.effectiveCacGbp)} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Num label="Service £/month" value={inv.servicePlanMonthlyGbp} onChange={(v) => set({ servicePlanMonthlyGbp: v })} />
            <Num label="Attach %" value={inv.servicePlanAttachPct} onChange={(v) => set({ servicePlanAttachPct: v })} />
            <Num label="Service years" value={inv.servicePlanYears} onChange={(v) => set({ servicePlanYears: v })} />
            <Num label="Referral %" value={inv.referralPct} onChange={(v) => set({ referralPct: v })} />
          </div>
        </section>

        {/* The round */}
        <section className="rounded-2xl border border-line bg-white p-5">
          <h3 className="font-bold">The round</h3>
          <div className="mt-3 space-y-1.5 text-sm">
            <Fact k="Raise" v={gbp(round.raiseGbp)} strong />
            <Fact k="Pre-money" v={gbp(round.preMoneyGbp)} />
            <Fact k="Post-money" v={gbp(round.postMoneyGbp)} />
          </div>
          {/* Ownership split: identity by fixed hue order, 2px gaps, labels in ink */}
          <div className="mt-4">
            <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full">
              <div className="bg-ink-900" style={{ width: `${round.founderPct}%` }} />
              <div className="bg-accent-500" style={{ width: `${round.investorPct}%` }} />
              <div className="bg-sage-500" style={{ width: `${round.optionPoolPct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700">
              <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-ink-900 align-middle" />Founder {round.founderPct}%</span>
              <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-accent-500 align-middle" />Investors {round.investorPct}%</span>
              <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-sage-500 align-middle" />Option pool {round.optionPoolPct}%</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Num
              label="Raise £ (blank = plan's ask)"
              value={raise ?? effectiveRaise}
              onChange={(v) => setRaise(v)}
            />
            <Num label="Pre-money £" value={inv.preMoneyGbp} onChange={(v) => set({ preMoneyGbp: v })} />
            <Num label="Option pool %" value={inv.optionPoolPct} onChange={(v) => set({ optionPoolPct: v })} />
            <button
              type="button"
              onClick={() => setRaise(null)}
              className="self-end rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-surface"
            >
              Reset raise to plan
            </button>
          </div>
        </section>
      </div>

      {/* Sensitivity tornado */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="font-bold">What actually moves the ask</h3>
        <p className="mt-1 text-xs text-ink-500">
          Each driver swung to its downside and upside; bars show the change in cash needed.
          Sage shrinks the raise, terracotta grows it.
        </p>
        <div className="mt-4 space-y-3">
          {rows.map((row) => {
            const worst = Math.max(row.askDeltaLowGbp, row.askDeltaHighGbp, 0);
            const best = Math.min(row.askDeltaLowGbp, row.askDeltaHighGbp, 0);
            return (
              <div key={row.driver} className="grid items-center gap-2 sm:grid-cols-[180px_1fr_150px]">
                <p className="text-sm font-medium">{row.driver}</p>
                <div className="relative h-5">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                  {best < 0 && (
                    <div
                      className="absolute inset-y-0.5 rounded-l-md bg-sage-500"
                      style={{
                        right: "50%",
                        width: `${(Math.abs(best) / maxAskDelta) * 48}%`,
                      }}
                    />
                  )}
                  {worst > 0 && (
                    <div
                      className="absolute inset-y-0.5 rounded-r-md bg-accent-500"
                      style={{ left: "50%", width: `${(worst / maxAskDelta) * 48}%` }}
                    />
                  )}
                </div>
                <p className="text-xs tabular-nums text-ink-500">
                  {compact(best)} to +{compact(worst).replace("£", "£")}
                  <span className="block text-ink-300">
                    range {row.low} → {row.high}
                  </span>
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* The goal timeline */}
      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="font-bold">The road to Series A</h3>
        <p className="mt-1 text-xs text-ink-500">
          Months come from the plan, not from hope: crank growth above and watch the dates pull
          in. Each milestone retires a risk, which is what a seed round is priced on.
        </p>
        <ol className="relative mt-5 space-y-6 border-l-2 border-line pl-6">
          {milestones.map((m) => {
            const proof = PROOF_STYLE[m.proves];
            return (
              <li key={m.title} className="relative">
                <span
                  aria-hidden
                  className={`absolute -left-[31px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                    m.month ? "border-accent-500 bg-accent-100" : "border-line bg-cream"
                  }`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      m.month ? "bg-ink-900 text-white" : "bg-surface text-ink-300"
                    }`}
                  >
                    {m.month ? `Month ${m.month}` : "Beyond this plan"}
                  </span>
                  <h4 className="font-bold">{m.title}</h4>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${proof.cls}`}>
                    {proof.label}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink-500">{m.detail}</p>
                <p className="mt-1 text-xs font-semibold text-ink-700">Gate: {m.kpi}</p>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MarketCard({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint: string;
  strong?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${strong ? "border-accent-400 bg-accent-50/60" : "border-line"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className="mt-1 text-2xl font-display">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold text-ink-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full rounded-xl border border-line bg-white px-2.5 py-1.5 text-right text-sm tabular-nums outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
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
