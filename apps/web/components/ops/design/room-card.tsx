"use client";

import {
  CAPACITY_OPTIONS_KW,
  PRELIMINARY_LOAD_LABEL,
  indoorCandidates,
  itemDisplayName,
  type CatalogueItem,
  type DesignDeviation,
  type DesignOverride,
  type DesignVariant,
  type RoomDesignInput,
} from "@aircon/domain";
import { Badge, Card, selectClass } from "@/components/kit";
import type { StudioMedia } from "@/lib/design-server";
import { NumberField, PhotoChoice, ReasonField } from "./fields";
import { AvailabilityBadge, ConfidenceBadge, kw, specLine } from "./labels";

const FLOOR: Record<string, string> = { ground: "Ground floor", first: "First floor", "second-plus": "Second floor or above", loft: "Loft" };
const ROUTE: Record<string, string> = {
  "through-wall": "Straight through the wall",
  "external-trunking": "Down the outside in trunking",
  "internal-concealed": "Hidden inside walls or ceilings",
  "via-loft": "Through the loft",
  other: "Other route",
};
const fmtW = (w: number) => `${String(Math.round(w)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} W`;

export interface RoomCardProps {
  room: RoomDesignInput;
  variant: DesignVariant;
  multipleVariants: boolean;
  catalogue: CatalogueItem[];
  media: StudioMedia[];
  editing: boolean;
  today: string;
  deviations: DesignDeviation[];
  overrides: DesignOverride[];
  reasons: Record<string, string>;
  onRoom: (patch: Partial<Pick<RoomDesignInput, "chosenKw" | "pipeRunM" | "heightDiffM" | "condensate">>) => void;
  onIndoor: (itemId: string) => void;
  onTakeSuggestedIndoor: () => void;
  onTogglePhoto: (mediaId: string) => void;
  onReason: (field: string, text: string) => void;
}

export function RoomCard(p: RoomCardProps) {
  const { room, variant, catalogue, editing } = p;
  const byId = new Map(catalogue.map((i) => [i.id, i]));
  const unitId = variant.roomUnits.find((u) => u.roomId === room.roomId)?.indoorItemId ?? "";
  const unit = byId.get(unitId);
  const suggestedId = variant.suggested?.roomUnits.find((u) => u.roomId === room.roomId)?.indoorItemId;
  const suggested = suggestedId ? byId.get(suggestedId) : undefined;
  const fits = indoorCandidates({ kw: room.chosenKw, tier: variant.tier, manufacturer: variant.manufacturer, catalogue });
  const others = catalogue
    .filter((i) => i.kind === "indoor" && i.active && i.status !== "discontinued" && !fits.some((f) => f.id === i.id))
    .sort((a, b) => (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "") || (a.specs?.coolingKw ?? 0) - (b.specs?.coolingKw ?? 0));
  const est = new Set(room.estimated ?? []);
  const surveyed = room.survey;
  const dev = (field: string) => p.deviations.find((d) => d.field === field);
  const reasonFor = (field: string) => p.reasons[field] ?? p.overrides.find((o) => o.field === field)?.reason ?? "";
  const roomMedia = p.media.filter((m) => m.roomId === room.roomId || room.layoutMediaIds.includes(m.id));
  const shownMedia = editing ? roomMedia : roomMedia.filter((m) => room.layoutMediaIds.includes(m.id));
  const optionLabel = (i: CatalogueItem) => `${itemDisplayName(i)}${specLine(i) ? ` · ${specLine(i)}` : ""}${i.confidence !== "verified" ? " · provisional" : ""}`;
  const fields = {
    kw: `rooms.${room.roomId}.chosenKw`,
    run: `rooms.${room.roomId}.pipeRunM`,
    height: `rooms.${room.roomId}.heightDiffM`,
    condensate: `rooms.${room.roomId}.condensate`,
    indoor: `variants.${variant.id}.rooms.${room.roomId}.indoor`,
  };
  const reasons = [
    { field: fields.kw, label: "the size", fmt: (v: string) => `${Number(v).toFixed(1)} kW`, revert: () => p.onRoom({ chosenKw: room.suggestedKw }) },
    { field: fields.run, label: "the pipe run", fmt: (v: string) => `${v} m`, revert: surveyed ? () => p.onRoom({ pipeRunM: surveyed.pipeRunM }) : undefined },
    { field: fields.height, label: "the height difference", fmt: (v: string) => `${v} m`, revert: surveyed ? () => p.onRoom({ heightDiffM: surveyed.heightDiffM }) : undefined },
    { field: fields.condensate, label: "the drain", fmt: (v: string) => (v === "pump" ? "Condensate pump" : "Gravity drain"), revert: surveyed ? () => p.onRoom({ condensate: surveyed.condensate }) : undefined },
    { field: fields.indoor, label: `the ${variant.label} unit`, fmt: (v: string) => (byId.get(v) ? itemDisplayName(byId.get(v)!) : v), revert: p.onTakeSuggestedIndoor },
  ];

  return (
    <Card as="article" padded={false} aria-labelledby={`room-${room.roomId}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 id={`room-${room.roomId}`} className="font-display text-xl text-ink-900">
            {room.roomName}
          </h3>
          <p className="mt-0.5 text-sm text-ink-500">
            {FLOOR[room.floor] ?? room.floor}
            {room.areaM2 ? ` · ${room.areaM2} m²` : " · area not measured"}
            {room.route ? ` · ${ROUTE[room.route] ?? room.route}` : ""}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-sm font-semibold text-ink-900">
            {fmtW(room.preliminaryLoadW)} <span className="font-normal text-ink-500">→ {kw(room.suggestedKw)} suggested</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-500 sm:max-w-[16rem]">{PRELIMINARY_LOAD_LABEL}</p>
        </div>
      </header>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{editing ? "Photos: tick the ones that form the approved layout" : "Approved layout"}</h4>
          {shownMedia.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-500">
              {editing ? "No photos for this room in the survey." : "No layout photo chosen."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {shownMedia.map((m) => (
                <PhotoChoice key={m.id} media={m} chosen={room.layoutMediaIds.includes(m.id)} editing={editing} onToggle={() => p.onTogglePhoto(m.id)} label={`${room.roomName} photo`} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {editing ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={`kw-${room.roomId}`} className="mb-1.5 block text-sm font-semibold text-ink-900">
                    Size
                  </label>
                  <select id={`kw-${room.roomId}`} className={selectClass} value={String(room.chosenKw)} onChange={(e) => p.onRoom({ chosenKw: Number(e.target.value) })}>
                    {CAPACITY_OPTIONS_KW.map((k) => (
                      <option key={k} value={String(k)}>
                        {kw(k)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-ink-500">
                    Suggested {kw(room.suggestedKw)}.{p.multipleVariants ? " Size, runs, drain and photos apply to every option." : ""}
                  </p>
                </div>
                <div>
                  <label htmlFor={`cond-${room.roomId}`} className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink-900">
                    Condensate {est.has("condensate") && !dev(fields.condensate) && <Badge tone="warn">Assumed</Badge>}
                  </label>
                  <select id={`cond-${room.roomId}`} className={selectClass} value={room.condensate} onChange={(e) => p.onRoom({ condensate: e.target.value as "gravity" | "pump" })}>
                    <option value="gravity">Gravity drain</option>
                    <option value="pump">Condensate pump</option>
                  </select>
                </div>
                <NumberField
                  label="Pipe run"
                  unit="m"
                  min={0.5}
                  max={100}
                  value={room.pipeRunM}
                  onCommit={(n) => p.onRoom({ pipeRunM: n })}
                  badge={est.has("pipeRunM") && !dev(fields.run) ? <Badge tone="warn">Estimated</Badge> : undefined}
                />
                <NumberField
                  label="Height difference"
                  unit="m"
                  min={0}
                  max={50}
                  value={room.heightDiffM}
                  onCommit={(n) => p.onRoom({ heightDiffM: n })}
                  badge={est.has("heightDiffM") && !dev(fields.height) ? <Badge tone="warn">Estimated</Badge> : undefined}
                />
              </div>
              <div>
                <label htmlFor={`unit-${variant.id}-${room.roomId}`} className="mb-1.5 block text-sm font-semibold text-ink-900">
                  Indoor unit <span className="font-normal text-ink-500">({variant.label} option)</span>
                </label>
                <select id={`unit-${variant.id}-${room.roomId}`} className={selectClass} value={unitId} onChange={(e) => p.onIndoor(e.target.value)}>
                  {!unit && <option value="">Choose a unit</option>}
                  {fits.length > 0 && (
                    <optgroup label={`Fits ${kw(room.chosenKw)}${variant.manufacturer ? `, ${variant.manufacturer}` : ""}`}>
                      {fits.map((i) => (
                        <option key={i.id} value={i.id}>
                          {optionLabel(i)}
                          {i.id === suggestedId ? " (suggested)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Other indoor units">
                    {others.map((i) => (
                      <option key={i.id} value={i.id}>
                        {optionLabel(i)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-ink-500">Size</dt>
                <dd className="font-semibold text-ink-900">{kw(room.chosenKw)}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Condensate</dt>
                <dd className="font-semibold text-ink-900">{room.condensate === "pump" ? "Condensate pump" : "Gravity drain"}</dd>
              </div>
              <div>
                <dt className="text-ink-500">Pipe run</dt>
                <dd className="font-semibold text-ink-900">
                  {room.pipeRunM} m {est.has("pipeRunM") && !dev(fields.run) && <Badge tone="warn">Estimated</Badge>}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">Height difference</dt>
                <dd className="font-semibold text-ink-900">
                  {room.heightDiffM} m {est.has("heightDiffM") && !dev(fields.height) && <Badge tone="warn">Estimated</Badge>}
                </dd>
              </div>
            </dl>
          )}

          {unit ? (
            <div className="rounded-2xl border border-line bg-surface/40 p-3">
              <p className="text-sm font-semibold text-ink-900">{itemDisplayName(unit)}</p>
              <p className="mt-0.5 text-xs text-ink-500">{specLine(unit)}</p>
              {unit.customerBlurb && <p className="mt-1.5 text-sm text-ink-700">“{unit.customerBlurb}”</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <ConfidenceBadge item={unit} today={p.today} />
                {unit.status !== "available" && <AvailabilityBadge status={unit.status} />}
              </div>
              {editing && suggested && suggested.id !== unit.id && (
                <p className="mt-2 text-xs text-ink-700">
                  The engine would pick {itemDisplayName(suggested)}.{" "}
                  <button type="button" onClick={p.onTakeSuggestedIndoor} className="font-semibold text-accent-700 underline-offset-2 hover:underline">
                    Use it
                  </button>
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">No indoor unit chosen for this room.</p>
          )}

          {reasons.map((r) => {
            const d = dev(r.field);
            if (!d) return null;
            if (!editing) {
              const o = p.overrides.find((x) => x.field === r.field);
              return (
                <p key={r.field} className="rounded-2xl border border-line bg-surface/50 px-3 py-2 text-sm text-ink-700">
                  <span className="font-semibold text-ink-900">Changed {r.label}</span> ({r.fmt(d.from)} → {r.fmt(d.to)}):{" "}
                  {o?.reason ? <span>“{o.reason}”, {o.by}</span> : <span className="font-semibold text-red-700">no reason given</span>}
                </p>
              );
            }
            return (
              <ReasonField
                key={r.field}
                label={r.label}
                from={`Was ${r.fmt(d.from)}`}
                to={`now ${r.fmt(d.to)}`}
                value={reasonFor(r.field)}
                onChange={(t) => p.onReason(r.field, t)}
                onRevert={r.revert}
              />
            );
          })}
        </div>
      </div>
    </Card>
  );
}
