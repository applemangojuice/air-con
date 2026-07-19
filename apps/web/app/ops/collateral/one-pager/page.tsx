import Link from "next/link";
import type { Metadata } from "next";
import {
  INVESTOR_BASE,
  PLAN_BASE,
  buildPlan,
  ltvModel,
  marketModel,
  roundModel,
} from "@aircon/domain";
import { BRAND, appHost } from "@/lib/brand";
import { gbp } from "@/lib/format";

export const metadata: Metadata = {
  title: "Investor one-pager · collateral · ops",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/** Compact money: £20.4bn / £1.2m / £450k — one-pager space is precious. */
function gbpShort(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `£${(amount / 1_000_000_000).toFixed(1)}bn`;
  if (abs >= 100_000_000) return `£${Math.round(amount / 1_000_000)}m`;
  if (abs >= 1_000_000) return `£${(amount / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `£${Math.round(amount / 1_000)}k`;
  return gbp(amount);
}

/**
 * The investor one-pager: a single printable A4 where every number is
 * computed by the same @aircon/domain models that power /ops/finance —
 * change an assumption there, reprint here, nothing drifts.
 */
export default function OnePagerPage() {
  const plan = buildPlan(PLAN_BASE);
  const ltv = ltvModel(PLAN_BASE, INVESTOR_BASE);
  const market = marketModel(PLAN_BASE, INVESTOR_BASE, plan);
  const round = roundModel(plan.summary.fundingNeedGbp, INVESTOR_BASE);

  return (
    <>
      <div className="no-print border-b border-line bg-surface px-4 py-3 text-sm">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <p className="text-ink-500">
            One A4 page, print to PDF. Every figure is computed live from the operating model —
            tune assumptions in <code>domain/finance.ts</code> / <code>investor.ts</code>.
          </p>
          <Link href="/ops/collateral" className="font-semibold text-accent-700 hover:underline">
            ← Collateral
          </Link>
        </div>
      </div>

      <main className="print-exact mx-auto my-8 max-w-3xl bg-white px-12 py-12 text-[13px] leading-relaxed shadow-lg print:my-0 print:max-w-none print:shadow-none">
        <header className="flex items-start justify-between">
          <div>
            <p className="text-2xl font-bold">
              {BRAND.nameLead} <span className="text-accent-500">{BRAND.nameHot}</span>
            </p>
            <p className="mt-1 text-ink-500">
              The operating system for residential air conditioning
            </p>
          </div>
          <div className="text-right text-xs text-ink-500">
            <p>Seed round</p>
            <p>{BRAND.supportEmail}</p>
            <p>{appHost()}</p>
          </div>
        </header>

        <div className="mt-6 grid grid-cols-2 gap-6">
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-accent-700">
              The problem
            </h2>
            <ul className="mt-2 ml-4 list-disc space-y-1 text-ink-700">
              <li>
                London summers now demand cooling; UK homes weren&apos;t built for it and the
                trade sells it like a bathroom refit: surveyor visits, wide estimates, weeks of
                waiting.
              </li>
              <li>
                Every quote is bespoke, so prices carry a fear premium and margins hide in
                opacity.
              </li>
            </ul>
          </section>
          <section>
            <h2 className="text-sm font-bold uppercase tracking-wide text-accent-700">
              The product
            </h2>
            <ul className="mt-2 ml-4 list-disc space-y-1 text-ink-700">
              <li>
                Two-minute self-survey → a <strong>guaranteed fixed price</strong>, priced by a
                deterministic engine, not a salesperson.
              </li>
              <li>
                A property-intelligence book (EPC + planning + audits) that designs the install
                <em> before</em> the customer asks — and targets the mailing that finds them.
              </li>
              <li>
                One platform from quote to install to monitoring: the data compounds with every
                job.
              </li>
            </ul>
          </section>
        </div>

        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-accent-700">
            Why street by street wins
          </h2>
          <p className="mt-2 text-ink-700">
            London&apos;s terraces repeat. Design the install once per street pattern and every
            subsequent home is cheaper to win (a letter, not an ad auction), faster to survey
            (records pre-fill the funnel) and faster to fit (the routing is known). Acquisition,
            design and labour costs all fall with density — that&apos;s the moat, and it&apos;s a
            data asset competitors would have to rebuild house by house.
          </p>
        </section>

        <section className="mt-6 rounded-2xl bg-surface p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-accent-700">
            The numbers <span className="font-normal normal-case text-ink-300">(base plan, computed live)</span>
          </h2>
          <div className="mt-3 grid grid-cols-4 gap-x-4 gap-y-3">
            <Num label="Avg order value" value={gbpShort(plan.unit.revenueGbp)} />
            <Num label="Gross margin" value={`${plan.unit.grossMarginPct}%`} />
            <Num label="CAC (mailing)" value={gbpShort(ltv.effectiveCacGbp)} />
            <Num label="LTV : CAC" value={`${ltv.ltvToCac}×`} />
            <Num label="Year-1 revenue" value={gbpShort(plan.summary.year1.revenueGbp)} />
            <Num label="Year-2 revenue" value={gbpShort(plan.summary.year2.revenueGbp)} />
            <Num
              label="Breakeven"
              value={
                plan.summary.breakevenMonth ? `Month ${plan.summary.breakevenMonth}` : "Post-plan"
              }
            />
            <Num label="Yr-2 installs" value={String(plan.summary.year2.installs)} />
            <Num label="TAM (London)" value={gbpShort(market.tamGbp)} />
            <Num label="SAM (beachhead boroughs)" value={gbpShort(market.samGbp)} />
            <Num label="Plan capture" value={gbpShort(market.somGbp)} />
            <Num
              label="Beachhead penetration"
              value={`${market.beachheadPenetrationPct}%`}
            />
          </div>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-accent-700">
              What exists today
            </h2>
            <ul className="mt-2 ml-4 list-disc space-y-1 text-ink-700">
              <li>Live quoting funnel with a versioned pricing engine (tested, replayable)</li>
              <li>Property intelligence: scored records across SW16/SW17 with per-address pages</li>
              <li>Project workflow, scheduling, procurement and P&amp;L tooling — one codebase</li>
              <li>First-party analytics on the whole funnel, lead-recovery automation</li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-accent-700">The ask</h2>
            <p className="mt-2 text-ink-700">
              Raising <strong>{gbpShort(round.raiseGbp)}</strong> (cash trough plus buffer, from
              the plan) at {gbpShort(round.preMoneyGbp)} pre — {round.investorPct}% to investors,
              {" "}{round.optionPoolPct}% pool. Funds the road from first commercial installs to a
              Series-A story: proven street-level unit economics and a repeatable
              mailing-to-install machine.
            </p>
          </div>
        </section>

        <footer className="mt-6 border-t border-line pt-3 text-[10px] text-ink-300">
          Figures generated by the live operating model in the platform&apos;s domain package
          (finance.ts / investor.ts); assumptions inspectable and tunable at /ops/finance.
          Illustrative until first commercial installs land actuals. {BRAND.legalName}.
        </footer>
      </main>
    </>
  );
}

function Num({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-300">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
