"use client";

import {
  isMultiOutdoor,
  itemDisplayName,
  type CatalogueItem,
  type CompatibilityRule,
  type DesignDeviation,
  type DesignOverride,
  type DesignRecord,
  type DesignVariant,
} from "@aircon/domain";
import { Badge, Card, selectClass } from "@/components/kit";
import type { StudioMedia } from "@/lib/design-server";
import { PhotoChoice, ReasonField } from "./fields";
import { AvailabilityBadge, ConfidenceBadge, specLine } from "./labels";

/**
 * Outdoor units for one option: which rooms each serves, the model, where
 * it goes, what the compatibility check says, and its circuit and charge.
 */

export interface SystemsPanelProps {
  design: DesignRecord;
  variant: DesignVariant;
  catalogue: CatalogueItem[];
  compatibility: CompatibilityRule[];
  media: StudioMedia[];
  editing: boolean;
  today: string;
  deviation?: DesignDeviation;
  overrides: DesignOverride[];
  reasons: Record<string, string>;
  onAssign: (roomId: string, target: number | "new") => void;
  onOutdoor: (index: number, itemId: string) => void;
  onPosition: (index: number, positionId: string) => void;
  onTogglePhoto: (index: number, mediaId: string) => void;
  onReason: (field: string, text: string) => void;
  onTakeSuggested: () => void;
}

export function SystemsPanel(p: SystemsPanelProps) {
  const { design, variant, catalogue, editing } = p;
  const byId = new Map(catalogue.map((i) => [i.id, i]));
  const roomName = (id: string) => design.rooms.find((r) => r.roomId === id)?.roomName ?? id;
  const positions = design.site?.outdoorPositions ?? [];
  const outdoors = catalogue.filter((i) => i.kind === "outdoor" && i.active && i.status !== "discontinued");
  const multis = outdoors.filter(isMultiOutdoor).sort((a, b) => (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "") || (a.ports ?? 0) - (b.ports ?? 0));
  const singles = outdoors.filter((o) => !isMultiOutdoor(o)).sort((a, b) => (a.manufacturer ?? "").localeCompare(b.manufacturer ?? "") || (a.specs?.coolingKw ?? 0) - (b.specs?.coolingKw ?? 0));
  const describe = (systems: { outdoorItemId: string; roomIds: string[] }[]) =>
    systems.map((s) => `${byId.get(s.outdoorItemId)?.model ?? (s.outdoorItemId || "no outdoor unit")} (${s.roomIds.map(roomName).join(", ")})`).join("; ");
  const field = `variants.${variant.id}.systems`;
  const o = p.overrides.find((x) => x.field === field);

  return (
    <div className="space-y-4">
      {editing && design.rooms.length > 1 && (
        <Card>
          <h4 className="text-sm font-semibold text-ink-900">Which outdoor unit serves each room</h4>
          <p className="mt-0.5 text-sm text-ink-500">Put rooms together on a multi-split, or give a room its own outdoor unit.</p>
          <ul className="mt-3 divide-y divide-line">
            {design.rooms.map((r) => {
              const at = variant.systems.findIndex((s) => s.roomIds.includes(r.roomId));
              return (
                <li key={r.roomId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <label htmlFor={`assign-${variant.id}-${r.roomId}`} className="text-sm font-medium text-ink-900">
                    {r.roomName}
                  </label>
                  <select
                    id={`assign-${variant.id}-${r.roomId}`}
                    className={`${selectClass} max-w-xs`}
                    value={String(at)}
                    onChange={(e) => p.onAssign(r.roomId, e.target.value === "new" ? "new" : Number(e.target.value))}
                  >
                    {variant.systems.map((s, i) => (
                      <option key={s.id} value={String(i)}>
                        Outdoor unit {i + 1}
                        {byId.get(s.outdoorItemId)?.model ? ` (${byId.get(s.outdoorItemId)!.model})` : ""}
                      </option>
                    ))}
                    <option value="new">Its own new outdoor unit</option>
                  </select>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {p.deviation &&
        (editing ? (
          <ReasonField
            label="the outdoor units"
            from={`Suggested: ${describe(variant.suggested?.systems ?? [])}`}
            to={`chosen: ${describe(variant.systems)}`}
            value={p.reasons[field] ?? o?.reason ?? ""}
            onChange={(t) => p.onReason(field, t)}
            onRevert={p.onTakeSuggested}
            revertLabel="Use the suggested arrangement"
          />
        ) : (
          <p className="rounded-2xl border border-line bg-surface/50 px-3 py-2 text-sm text-ink-700">
            <span className="font-semibold text-ink-900">Outdoor units changed from the suggestion</span> ({describe(variant.suggested?.systems ?? [])}):{" "}
            {o?.reason ? `“${o.reason}”, ${o.by}` : <span className="font-semibold text-red-700">no reason given</span>}
          </p>
        ))}

      {variant.systems.map((s, i) => {
        const outdoor = byId.get(s.outdoorItemId);
        const rule = s.ruleId ? p.compatibility.find((r) => r.id === s.ruleId) : undefined;
        const position = positions.find((x) => x.id === s.outdoorPositionId);
        const photoIds = new Set([...(s.layoutMediaIds ?? []), ...positions.map((x) => x.mediaId).filter((m): m is string => !!m)]);
        const photos = p.media.filter((m) => photoIds.has(m.id) || m.tag === "outdoor-location");
        const shown = editing ? photos : photos.filter((m) => (s.layoutMediaIds ?? []).includes(m.id));
        const c = s.compatibility;
        return (
          <Card as="article" key={s.id} padded={false} aria-labelledby={`sys-${variant.id}-${s.id}`}>
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h4 id={`sys-${variant.id}-${s.id}`} className="font-display text-xl text-ink-900">
                  Outdoor unit {i + 1}
                </h4>
                <p className="mt-0.5 text-sm text-ink-500">
                  {s.topology === "multi" ? `Multi-split for ${s.roomIds.map(roomName).join(", ")}` : `Single split for ${roomName(s.roomIds[0] ?? "")}`}
                </p>
              </div>
              <Badge tone={c.errors.length ? "danger" : c.warnings.length ? "warn" : "success"} dot>
                {c.errors.length ? "Doesn't work as chosen" : c.warnings.length ? "Works, with checks" : "Works"}
              </Badge>
            </header>
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="space-y-4">
                {editing ? (
                  <div>
                    <label htmlFor={`out-${variant.id}-${s.id}`} className="mb-1.5 block text-sm font-semibold text-ink-900">
                      Outdoor model
                    </label>
                    <select id={`out-${variant.id}-${s.id}`} className={selectClass} value={s.outdoorItemId} onChange={(e) => p.onOutdoor(i, e.target.value)}>
                      {!outdoor && <option value="">Choose an outdoor unit</option>}
                      <optgroup label={s.roomIds.length > 1 ? "Multi-split (suits these rooms)" : "Multi-split"}>
                        {multis.map((m) => (
                          <option key={m.id} value={m.id}>
                            {itemDisplayName(m)} · {specLine(m)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Single split">
                        {singles.map((m) => (
                          <option key={m.id} value={m.id}>
                            {itemDisplayName(m)} · {specLine(m)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-ink-900">{outdoor ? itemDisplayName(outdoor) : "No outdoor unit chosen"}</p>
                )}
                {outdoor && (
                  <div className="flex flex-wrap gap-1.5">
                    <ConfidenceBadge item={outdoor} today={p.today} />
                    {outdoor.status !== "available" && <AvailabilityBadge status={outdoor.status} />}
                    <Badge>{specLine(outdoor)}</Badge>
                  </div>
                )}

                <div aria-live="polite">
                  {c.errors.length > 0 && (
                    <ul className="space-y-1 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      {c.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                  {c.warnings.length > 0 && (
                    <ul className="mt-2 space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {c.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {rule && (
                  <p className="text-sm text-ink-500">
                    Checked against the{" "}
                    <span className={rule.confidence === "verified" ? "font-semibold text-emerald-800" : "font-semibold text-amber-800"}>
                      {rule.confidence === "verified" ? "verified" : "provisional"}
                    </span>{" "}
                    rule for {rule.outdoorModel}
                    {rule.source && (
                      <>
                        {" "}
                        (
                        <a href={rule.source.url} target="_blank" rel="noopener noreferrer" className="text-accent-700 underline-offset-2 hover:underline">
                          source
                        </a>
                        )
                      </>
                    )}
                    .
                  </p>
                )}

                <dl className="grid gap-3 rounded-2xl border border-line bg-surface/40 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Electrics</dt>
                    <dd className="mt-1 text-ink-900">
                      {s.electrical.breaker}, {s.electrical.cableMm2} mm² cable, {s.electrical.isolator.replace(" weatherproof rotary isolator", " isolator")}
                    </dd>
                    <dd className="mt-1">
                      <Badge tone={s.electrical.breakerSource === "manufacturer" ? "success" : "warn"}>
                        {s.electrical.breakerSource === "manufacturer" ? "Manufacturer's breaker" : "Breaker by rule of thumb"}
                      </Badge>
                    </dd>
                    {s.electrical.routeNote && <dd className="mt-1 text-xs text-ink-500">{s.electrical.routeNote}</dd>}
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Refrigerant (R32)</dt>
                    {s.refrigerant.chargeKnown === false ? (
                      <dd className="mt-1 text-amber-900">{s.refrigerant.totalPipeM} m of pipe. Extra charge unknown: the catalogue has no pre-charge figures for this unit.</dd>
                    ) : (
                      <dd className="mt-1 text-ink-900">
                        {s.refrigerant.totalPipeM} m of pipe, {s.refrigerant.prechargedPipeM} m pre-charged:{" "}
                        <span className="font-semibold">{s.refrigerant.additionalChargeG > 0 ? `add ${s.refrigerant.additionalChargeG} g` : "no top-up"}</span>
                      </dd>
                    )}
                  </div>
                </dl>
              </div>

              <div className="space-y-3">
                {editing ? (
                  <div>
                    <label htmlFor={`pos-${variant.id}-${s.id}`} className="mb-1.5 block text-sm font-semibold text-ink-900">
                      Where it goes
                    </label>
                    <select id={`pos-${variant.id}-${s.id}`} className={selectClass} value={s.outdoorPositionId ?? ""} onChange={(e) => p.onPosition(i, e.target.value)}>
                      {!position && <option value="">Choose a position from the survey</option>}
                      {positions.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                          {typeof x.distanceToNeighbourWindowM === "number" ? ` · ${x.distanceToNeighbourWindowM} m to neighbour` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="text-sm text-ink-700">
                    <span className="font-semibold text-ink-900">Position:</span> {position ? position.label : "not chosen"}
                    {typeof position?.distanceToNeighbourWindowM === "number" ? ` · ${position.distanceToNeighbourWindowM} m to the nearest neighbouring window` : ""}
                  </p>
                )}
                {shown.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {shown.map((m) => (
                      <PhotoChoice key={m.id} media={m} chosen={(s.layoutMediaIds ?? []).includes(m.id)} editing={editing} onToggle={() => p.onTogglePhoto(i, m.id)} label="Outdoor position photo" />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-500">No outdoor photo{editing ? " in the survey" : " chosen"}.</p>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
