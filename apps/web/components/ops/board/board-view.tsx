"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/kit/badge";
import { fmtDay, money } from "@/lib/format";
import {
  BOARD_COLUMNS,
  filterCards,
  filtersToSearch,
  groupByColumn,
  isOverdue,
  type BoardCard,
  type BoardFilters,
} from "./board-model";

/**
 * The board, client side: filters and search run instantly over the cards
 * the server built (readiness included), and live in the URL so a refresh
 * or a shared link shows the same view.
 */

type View = "board" | "list";

export function BoardView({
  cards,
  me,
  today,
  initial,
}: {
  cards: BoardCard[];
  me: string;
  today: string;
  initial: BoardFilters & { view: View };
}) {
  const [q, setQ] = useState(initial.q ?? "");
  const [mine, setMine] = useState(Boolean(initial.mine));
  const [pilots, setPilots] = useState(Boolean(initial.pilots));
  const [blocked, setBlocked] = useState(Boolean(initial.blocked));
  const [view, setView] = useState<View>(initial.view);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const search = filtersToSearch({ q, mine, pilots, blocked, view });
      window.history.replaceState(null, "", `${window.location.pathname}${search}`);
    }, 250);
    return () => clearTimeout(t);
  }, [q, mine, pilots, blocked, view]);

  const shown = useMemo(() => filterCards(cards, { q, mine, pilots, blocked }, me), [cards, q, mine, pilots, blocked, me]);
  const grouped = useMemo(() => groupByColumn(shown), [shown]);
  const filtering = Boolean(q.trim() || mine || pilots || blocked);
  const clear = () => {
    setQ("");
    setMine(false);
    setPilots(false);
    setBlocked(false);
  };

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="board-search" className="sr-only">
            Search projects
          </label>
          <input
            id="board-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, address, postcode, project or invoice number"
            className="min-h-11 w-full rounded-full border border-line bg-white px-4 text-sm text-ink-900 outline-none placeholder:text-ink-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          <Toggle on={mine} onClick={() => setMine(!mine)}>
            My projects
          </Toggle>
          <Toggle on={pilots} onClick={() => setPilots(!pilots)}>
            Pilots only
          </Toggle>
          <Toggle on={blocked} onClick={() => setBlocked(!blocked)}>
            Blocked only
          </Toggle>
          <div className="ml-auto flex rounded-full border border-line bg-white p-0.5 lg:ml-2" role="group" aria-label="View">
            {(["board", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`min-h-9 rounded-full px-3 text-sm font-semibold transition ${view === v ? "bg-ink-900 text-white" : "text-ink-700 hover:text-ink-900"}`}
              >
                {v === "board" ? "Board" : "List"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 text-sm text-ink-500" aria-live="polite">
        {filtering ? `${shown.length} of ${cards.length} projects` : `${cards.length} project${cards.length === 1 ? "" : "s"}`}
        {filtering && (
          <button type="button" onClick={clear} className="ml-2 font-semibold text-accent-700 underline-offset-2 hover:underline">
            Clear filters
          </button>
        )}
      </p>

      {shown.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-line bg-white/60 px-6 py-10 text-center">
          <p className="font-semibold text-ink-900">No projects match</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-500">Try fewer words, or clear the filters.</p>
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={clear} className="min-h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink-900 hover:bg-surface">
              Clear filters
            </button>
          </div>
        </div>
      ) : view === "board" ? (
        <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6" tabIndex={0} aria-label="Board columns, scrolls sideways">
          <div className="flex min-w-max snap-x gap-3">
            {BOARD_COLUMNS.map((col) => {
              const list = grouped[col.id];
              const value = list.reduce((s, c) => s + c.valuePence, 0);
              return (
                <section key={col.id} aria-labelledby={`col-${col.id}`} className="w-[17rem] shrink-0 snap-start rounded-2xl bg-surface/70 p-2">
                  <div className="flex items-baseline justify-between gap-2 px-2 pb-2 pt-1">
                    <h2 id={`col-${col.id}`} className="text-sm font-semibold text-ink-900">
                      {col.label} <span className="font-normal text-ink-500">{list.length}</span>
                    </h2>
                    {list.length > 0 && <span className="text-xs tabular-nums text-ink-500">{money(value)}</span>}
                  </div>
                  {list.length === 0 ? (
                    <p className="px-2 pb-3 text-xs text-ink-500">Nothing here</p>
                  ) : (
                    <ul className="space-y-2">
                      {list.map((c) => (
                        <li key={c.id}>
                          <Card card={c} today={today} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <ListView cards={shown} today={today} />
      )}
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition ${on ? "border-accent-600 bg-accent-50 text-accent-700" : "border-line bg-white text-ink-700 hover:border-ink-300"}`}
    >
      {on && <span aria-hidden>✓ </span>}
      {children}
    </button>
  );
}

function Due({ card, today }: { card: BoardCard; today: string }) {
  if (!card.nextAction.dueOn) return null;
  const late = isOverdue(card, today);
  return <span className={late ? "font-semibold text-red-700" : "text-ink-500"}>{late ? `overdue, ${fmtDay(card.nextAction.dueOn)}` : `due ${fmtDay(card.nextAction.dueOn)}`}</span>;
}

function Card({ card: c, today }: { card: BoardCard; today: string }) {
  return (
    <Link
      href={`/ops/projects/${c.id}`}
      className={`block rounded-xl border bg-white p-3 shadow-sm transition hover:border-accent-400 hover:shadow ${c.blockers > 0 ? "border-l-4 border-l-red-500 border-y-line border-r-line" : "border-line"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {c.pilot && <Badge tone="accent">Pilot {c.pilot.number}</Badge>}
          {c.demo && <Badge tone="warn">DEMO</Badge>}
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900" title={c.valueKind === "contract" ? "Contract total" : "Instant price"}>
          {money(c.valuePence)}
          {c.valueKind === "instant" && <span className="ml-0.5 text-[10px] font-normal text-ink-500">est.</span>}
        </span>
      </div>
      <p className="mt-1.5 truncate font-semibold text-ink-900">{c.customer}</p>
      <p className="truncate text-xs text-ink-500">
        {c.outcode || "No postcode"}
        {c.addressLine ? ` · ${c.addressLine}` : ""}
      </p>
      <p className="mt-2 line-clamp-2 text-sm text-ink-700">
        <span className="font-semibold text-ink-900">Next:</span> {c.nextAction.text}
        {c.nextAction.owner && <span className="text-ink-500"> ({c.nextAction.owner})</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Due card={c} today={today} />
        <span className="text-ink-500">{c.owner ? c.owner.name : "No owner"}</span>
        <span className="ml-auto flex gap-1">
          {c.blockers > 0 && <Badge tone="danger">{c.blockers} blocking</Badge>}
          {c.warnings > 0 && <Badge tone="warn">{c.warnings} to check</Badge>}
        </span>
      </div>
    </Link>
  );
}

function ListView({ cards, today }: { cards: BoardCard[]; today: string }) {
  const order = new Map(BOARD_COLUMNS.map((c, i) => [c.id, i]));
  const sorted = [...cards].sort((a, b) => (order.get(a.column) ?? 0) - (order.get(b.column) ?? 0) || (a.pilot?.number ?? 999) - (b.pilot?.number ?? 999));
  const label = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, c.label]));
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <caption className="sr-only">Projects</caption>
        <thead className="border-b border-line bg-surface text-xs text-ink-500">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold">Customer</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Area</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Stage</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">Value</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Next action</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Owner</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Readiness</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((c) => (
            <tr key={c.id} className="align-top hover:bg-surface/40">
              <td className="px-4 py-2.5">
                <Link href={`/ops/projects/${c.id}`} className="font-semibold text-accent-700 hover:underline">
                  {c.customer}
                </Link>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {c.pilot && <Badge tone="accent">Pilot {c.pilot.number}</Badge>}
                  {c.demo && <Badge tone="warn">DEMO</Badge>}
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-ink-700">{c.outcode}</td>
              <td className="whitespace-nowrap px-4 py-2.5">{label[c.column]}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                {money(c.valuePence)}
                {c.valueKind === "instant" && <span className="ml-0.5 text-[10px] text-ink-500">est.</span>}
              </td>
              <td className="px-4 py-2.5">
                <span className="text-ink-900">{c.nextAction.text}</span>
                <span className="block text-xs">
                  <Due card={c} today={today} />
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-ink-700">{c.owner?.name ?? <span className="text-ink-500">Nobody</span>}</td>
              <td className="px-4 py-2.5">
                <span className="flex flex-wrap gap-1">
                  {c.blockers > 0 && <Badge tone="danger">{c.blockers} blocking</Badge>}
                  {c.warnings > 0 && <Badge tone="warn">{c.warnings} to check</Badge>}
                  {c.blockers === 0 && c.warnings === 0 && <span className="text-xs text-ink-500">{c.column === "closed" ? "Closed" : "Clear"}</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
