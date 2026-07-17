"use client";

import { useMemo, useState } from "react";
import {
  ARCHETYPES,
  buildPresetRoom,
  designSystem,
  emptyConstraints,
  emptyMarketing,
  emptyPlanning,
  type DesignInput,
  type DesignVerdict,
  type ElectricsCondition,
  type OutdoorLocation,
  type PropertyIntel,
  type RuleStatus,
  type Survey,
  type SystemBlueprint,
  type SystemUnit,
} from "@aircon/domain";

/**
 * The design studio: the rules engine and equipment selection engine on one
 * screen. Pick a property, press the button, get a buildable spec with its
 * traffic lights. Everything runs the live domain engines in the browser.
 */

interface SampleProperty {
  id: string;
  label: string;
  detail: string;
  survey: Survey;
}

function sampleFromArchetype(archetypeId: string, addressLine: string): SampleProperty | null {
  const archetype = ARCHETYPES.find((a) => a.id === archetypeId);
  if (!archetype) return null;
  const rooms = archetype.typicalRooms
    .map((preset, i) => ({ preset, i }))
    .filter(({ preset }) => preset.popular)
    .map(({ preset, i }) => buildPresetRoom(archetype.id, preset, i));
  const permutation = archetype.permutations[0];
  if (!rooms.length || !permutation) return null;
  return {
    id: archetype.id,
    label: archetype.name,
    detail: `${archetype.eraLabel} · ${rooms.length} rooms`,
    survey: {
      postcode: "SW16 2BE",
      addressLine,
      archetypeId: archetype.id,
      permutationId: permutation.id,
      property: {
        type: archetype.matches.types[0] ?? "terraced",
        era: archetype.matches.eras[0] ?? "pre-1930",
        bedrooms: rooms.filter((r) => r.type === "bedroom").length || 2,
        ownership: "owner",
      },
      rooms,
      outdoor: { location: permutation.outdoorLocation, photos: [] },
      electrics: { condition: "modern-spare-ways", photos: [] },
    },
  };
}

const SAMPLES: SampleProperty[] = [
  sampleFromArchetype("victorian-terrace", "34 Hillside Road"),
  sampleFromArchetype("thirties-semi", "18 Ribblesdale Avenue"),
  sampleFromArchetype("new-build-house", "5 Foundry Walk"),
  sampleFromArchetype("townhouse", "22 Weir Court"),
  sampleFromArchetype("postwar-council", "9 Elmfield House"),
].filter((s): s is SampleProperty => s !== null);

type ConstraintChoice = "clean" | "conservation" | "listed" | "none-held";

function intelFor(survey: Survey, choice: ConstraintChoice): PropertyIntel | undefined {
  if (choice === "none-held") return undefined;
  return {
    id: "studio-sample",
    address: { line1: survey.addressLine, postcode: survey.postcode, outcode: "SW16" },
    planning: emptyPlanning(),
    constraints: {
      ...emptyConstraints(),
      conservationArea: choice === "conservation",
      listedBuilding: choice === "listed",
    },
    marketing: emptyMarketing(),
  };
}

const VERDICT_UI: Record<DesignVerdict, { dot: string; chip: string; title: string; body: string }> = {
  "auto-approved": {
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 border-emerald-200 text-emerald-800",
    title: "Auto-approved",
    body: "Every rule passed. No engineer needed; the spec below is buildable as-is.",
  },
  "needs-review": {
    dot: "bg-amber-500",
    chip: "bg-amber-50 border-amber-200 text-amber-800",
    title: "Needs review",
    body: "The design is complete, but an engineer glances at the amber rules before it locks.",
  },
  "cannot-determine": {
    dot: "bg-red-500",
    chip: "bg-red-50 border-red-200 text-red-800",
    title: "Cannot determine",
    body: "Data is missing, so no design gets auto-approved. The red rules say exactly what unlocks it.",
  },
};

const STATUS_DOT: Record<RuleStatus, string> = {
  pass: "bg-emerald-500",
  review: "bg-amber-500",
  fail: "bg-red-500",
};

const STATUS_LABEL: Record<RuleStatus, string> = {
  pass: "Pass",
  review: "Review",
  fail: "Cannot determine",
};

const ELECTRICS_OPTIONS: { value: ElectricsCondition; label: string }[] = [
  { value: "modern-spare-ways", label: "Modern board, spare ways" },
  { value: "modern-full", label: "Modern board, full" },
  { value: "older-fuse-box", label: "Older fuse board" },
  { value: "unsure", label: "Unknown (no photo yet)" },
];

const OUTDOOR_OPTIONS: { value: OutdoorLocation; label: string }[] = [
  { value: "ground-rear", label: "Ground, rear" },
  { value: "ground-side", label: "Ground, side" },
  { value: "wall-bracket", label: "Wall bracket" },
  { value: "flat-roof", label: "Flat roof" },
  { value: "balcony", label: "Balcony" },
  { value: "unsure", label: "Undecided" },
];

const CONSTRAINT_OPTIONS: { value: ConstraintChoice; label: string }[] = [
  { value: "clean", label: "No constraints on record" },
  { value: "conservation", label: "Conservation area" },
  { value: "listed", label: "Listed building" },
  { value: "none-held", label: "No property record held" },
];

export function DesignStudio() {
  const [sampleId, setSampleId] = useState(SAMPLES[0]!.id);
  const [electrics, setElectrics] = useState<ElectricsCondition>("modern-spare-ways");
  const [outdoor, setOutdoor] = useState<OutdoorLocation>("ground-rear");
  const [constraint, setConstraint] = useState<ConstraintChoice>("clean");
  const [occupants, setOccupants] = useState(3);
  const [blueprint, setBlueprint] = useState<SystemBlueprint | null>(null);

  const sample = useMemo(() => SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0]!, [sampleId]);

  function run() {
    const survey: Survey = {
      ...sample.survey,
      outdoor: { ...sample.survey.outdoor, location: outdoor },
      electrics: { ...sample.survey.electrics, condition: electrics },
    };
    const input: DesignInput = {
      survey,
      intel: intelFor(survey, constraint),
      occupants,
    };
    setBlueprint(designSystem(input));
  }

  const select =
    "mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none";

  return (
    <div>
      {/* Inputs */}
      <section className="rounded-3xl border border-line bg-white p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block text-sm font-semibold lg:col-span-2">
            Property
            <select className={select} value={sampleId} onChange={(e) => { setSampleId(e.target.value); setBlueprint(null); }}>
              {SAMPLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.survey.addressLine}: {s.label} ({s.detail})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Electrics
            <select className={select} value={electrics} onChange={(e) => { setElectrics(e.target.value as ElectricsCondition); setBlueprint(null); }}>
              {ELECTRICS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Outdoor position
            <select className={select} value={outdoor} onChange={(e) => { setOutdoor(e.target.value as OutdoorLocation); setBlueprint(null); }}>
              {OUTDOOR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Planning record
            <select className={select} value={constraint} onChange={(e) => { setConstraint(e.target.value as ConstraintChoice); setBlueprint(null); }}>
              {CONSTRAINT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-3 text-sm font-semibold">
            Occupants
            <input
              type="range"
              min={1}
              max={7}
              value={occupants}
              onChange={(e) => { setOccupants(Number(e.target.value)); setBlueprint(null); }}
              className="accent-accent-600"
            />
            <span className="w-4 text-ink-500">{occupants}</span>
          </label>
          <button
            onClick={run}
            className="rounded-full bg-accent-600 px-8 py-3 text-base font-bold text-white shadow-sm transition hover:bg-accent-700"
          >
            Design system
          </button>
        </div>
      </section>

      {blueprint === null ? (
        <p className="mt-8 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-500">
          Pick a property, press the button. The rules engine checks eight
          things, then the kit picks itself. Genuinely one button.
        </p>
      ) : (
        <Blueprint blueprint={blueprint} />
      )}
    </div>
  );
}

function Blueprint({ blueprint }: { blueprint: SystemBlueprint }) {
  const v = VERDICT_UI[blueprint.verdict];
  const counts = {
    pass: blueprint.rules.filter((r) => r.status === "pass").length,
    review: blueprint.rules.filter((r) => r.status === "review").length,
    fail: blueprint.rules.filter((r) => r.status === "fail").length,
  };

  return (
    <div className="mt-6 space-y-6">
      {/* Verdict */}
      <section className={`rounded-3xl border p-6 ${v.chip}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`h-4 w-4 rounded-full ${v.dot}`} />
            <h2 className="text-xl font-bold">{v.title}</h2>
          </div>
          <p className="text-sm font-semibold">
            {counts.pass} pass · {counts.review} review · {counts.fail} cannot determine
          </p>
        </div>
        <p className="mt-2 text-sm">{v.body}</p>
      </section>

      {/* Rules */}
      <section>
        <h3 className="text-lg font-display">Design rules</h3>
        <p className="mt-1 text-sm text-ink-500">
          Every property gets the same eight checks before any kit is chosen.
          Engineers validate ambers and reds; greens never wait for a human.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {blueprint.rules.map((rule) => (
            <div key={rule.id} className="rounded-2xl border border-line bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[rule.status]}`} />
                  <p className="text-sm font-bold">{rule.title}</p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-ink-500">
                  {STATUS_LABEL[rule.status]}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-500">{rule.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Systems */}
      <section>
        <h3 className="text-lg font-display">
          Selected equipment
          <span className="ml-2 text-sm font-normal text-ink-500">
            {blueprint.totalPipeM} m of pipe · {blueprint.penetrations} penetrations ·{" "}
            {blueprint.installDays} install day{blueprint.installDays === 1 ? "" : "s"}
          </span>
        </h3>
        <div className="mt-3 space-y-4">
          {blueprint.systems.map((sys, i) => (
            <SystemCard key={sys.outdoor.sku + i} sys={sys} n={i + 1} count={blueprint.systems.length} />
          ))}
        </div>
      </section>

      {/* BOM */}
      <section>
        <h3 className="text-lg font-display">Bill of materials</h3>
        <p className="mt-1 text-sm text-ink-500">
          The pick list the warehouse packs and the courier ships. Feeds the{" "}
          procurement order book automatically.
        </p>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-300">
                <th className="px-4 py-2.5 font-semibold">SKU</th>
                <th className="px-4 py-2.5 font-semibold">Item</th>
                <th className="px-4 py-2.5 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {blueprint.bom.map((line) => (
                <tr key={line.sku} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-ink-500">{line.sku}</td>
                  <td className="px-4 py-2">{line.label}</td>
                  <td className="px-4 py-2 text-right font-semibold">{line.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SystemCard({ sys, n, count }: { sys: SystemUnit; n: number; count: number }) {
  return (
    <div className="rounded-3xl border border-line bg-white p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-bold">
          {count > 1 && <span className="text-ink-300">System {n} · </span>}
          {sys.outdoor.label}
          <span className="ml-2 font-mono text-xs text-ink-300">{sys.outdoor.sku}</span>
        </h4>
        <span className="text-xs font-semibold text-ink-500">
          {sys.topology === "multi" ? `multi-split, ${sys.rooms.length} indoor units` : "single split"}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-500">{sys.mounting}</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-300">
              <th className="py-2 pr-3 font-semibold">Room</th>
              <th className="py-2 pr-3 font-semibold">Load</th>
              <th className="py-2 pr-3 font-semibold">Indoor unit</th>
              <th className="py-2 pr-3 font-semibold">Pipe pair</th>
              <th className="py-2 pr-3 font-semibold">Run</th>
              <th className="py-2 font-semibold">Drain</th>
            </tr>
          </thead>
          <tbody>
            {sys.rooms.map((room) => (
              <tr key={room.roomId} className="border-b border-line/60 last:border-0">
                <td className="py-2 pr-3 font-semibold">{room.roomName}</td>
                <td className="py-2 pr-3 text-ink-500">{room.loadWatts} W</td>
                <td className="py-2 pr-3">
                  {room.capacityKw.toFixed(1)} kW{" "}
                  <span className="font-mono text-xs text-ink-300">{room.indoorSku}</span>
                </td>
                <td className="py-2 pr-3 text-ink-500">
                  {room.liquidMm} / {room.gasMm} mm
                </td>
                <td className="py-2 pr-3 text-ink-500">{room.pipeRunM} m</td>
                <td className="py-2">
                  {room.condensatePump ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      pump
                    </span>
                  ) : (
                    <span className="text-xs text-ink-500">gravity</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-2xl bg-surface/60 p-4">
          <p className="font-semibold uppercase tracking-wide text-ink-300">Electrical</p>
          <p className="mt-1.5 leading-relaxed text-ink-700">
            {sys.electrical.runningAmps} A running · {sys.electrical.supplyCableMm2} mm² supply ·{" "}
            {sys.electrical.breaker} · {sys.electrical.isolator}
            {sys.electrical.spurNote ? ` · ${sys.electrical.spurNote}` : ""}
          </p>
        </div>
        <div className="rounded-2xl bg-surface/60 p-4">
          <p className="font-semibold uppercase tracking-wide text-ink-300">Refrigerant</p>
          <p className="mt-1.5 leading-relaxed text-ink-700">
            {sys.refrigerant.type} · {sys.refrigerant.totalPipeM} m total pipe, pre-charged for{" "}
            {sys.refrigerant.prechargedPipeM} m
            {sys.refrigerant.additionalChargeG > 0
              ? ` · additional charge ${sys.refrigerant.additionalChargeG} g`
              : " · no additional charge"}
          </p>
        </div>
      </div>
    </div>
  );
}
