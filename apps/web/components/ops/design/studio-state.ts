import {
  applyDesignEdits,
  autoChoice,
  autoSystems,
  editsFromDesign,
  type CatalogueItem,
  type CompatibilityRule,
  type DesignEdits,
  type DesignRecord,
  type SystemChoice,
} from "@aircon/domain";

/**
 * The design studio's editing rules, as pure functions over DesignEdits
 * (what a person chose), so the browser preview and the tests agree:
 *
 *  * A choice that was following the engine keeps following it: change a
 *    room's size and its unit (and the outdoor unit) move to the engine's
 *    new pick, unless someone already picked by hand.
 *  * A hand-picked choice stays put; the deviation then needs a reason.
 *  * Positions and layout photos travel with their rooms when systems are
 *    rearranged.
 */

export interface StudioCtx {
  design: DesignRecord;
  catalogue: CatalogueItem[];
  compatibility: CompatibilityRule[];
  by: string;
}

/** The whole design as it would be saved, recomputed in the browser. */
export function previewOf(ctx: StudioCtx, edits: DesignEdits): DesignRecord {
  return applyDesignEdits(ctx.design, edits, {
    catalogue: ctx.catalogue,
    compatibility: ctx.compatibility,
    by: ctx.by,
    at: ctx.design.createdAt,
    id: ctx.design.id,
    version: ctx.design.version,
  });
}

export const systemsKey = (systems: { outdoorItemId: string; roomIds: string[] }[]) =>
  systems
    .map((s) => `${s.outdoorItemId}:${[...s.roomIds].sort().join("+")}`)
    .sort()
    .join("|");

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** New systems keep the id, position and outdoor photos of the old system that held their first room. */
export function carry(next: SystemChoice[], old: SystemChoice[]): SystemChoice[] {
  const used = new Set<string>();
  return next.map((s) => {
    const prev = old.find((o) => o.roomIds.some((r) => s.roomIds.includes(r)) && !used.has(o.id ?? o.roomIds.join("+")));
    if (!prev) return { outdoorItemId: s.outdoorItemId, roomIds: [...s.roomIds] };
    used.add(prev.id ?? prev.roomIds.join("+"));
    return {
      ...(prev.id ? { id: prev.id } : {}),
      outdoorItemId: s.outdoorItemId,
      roomIds: [...s.roomIds],
      ...(prev.outdoorPositionId ? { outdoorPositionId: prev.outdoorPositionId } : {}),
      ...(prev.layoutMediaIds ? { layoutMediaIds: [...prev.layoutMediaIds] } : {}),
    };
  });
}

/**
 * After an edit (prev → next), let the choices that were following the
 * engine follow its new suggestion: first the indoor units, then (with the
 * units settled) the outdoor arrangement.
 */
export function follow(ctx: StudioCtx, prev: DesignEdits, next: DesignEdits): DesignEdits {
  const before = previewOf(ctx, prev);
  const mid = previewOf(ctx, next);
  const out = clone(next);
  for (const ev of out.variants) {
    const bv = before.variants.find((v) => v.id === ev.id);
    const mv = mid.variants.find((v) => v.id === ev.id);
    const pe = prev.variants.find((v) => v.id === ev.id);
    if (!bv || !mv || !pe) continue;
    ev.roomUnits = ev.roomUnits.map((u) => {
      const was = pe.roomUnits.find((x) => x.roomId === u.roomId);
      const wasSuggested = bv.suggested?.roomUnits.find((x) => x.roomId === u.roomId);
      const nowSuggested = mv.suggested?.roomUnits.find((x) => x.roomId === u.roomId);
      const untouched = was?.indoorItemId === u.indoorItemId;
      const following = Boolean(was && wasSuggested && was.indoorItemId === wasSuggested.indoorItemId);
      return untouched && following && nowSuggested?.indoorItemId ? { ...u, indoorItemId: nowSuggested.indoorItemId } : u;
    });
  }
  const settled = previewOf(ctx, out);
  for (const ev of out.variants) {
    const bv = before.variants.find((v) => v.id === ev.id);
    const sv = settled.variants.find((v) => v.id === ev.id);
    const pe = prev.variants.find((v) => v.id === ev.id);
    if (!bv?.suggested || !sv?.suggested || !pe) continue;
    const untouched = systemsKey(ev.systems) === systemsKey(pe.systems);
    const following = systemsKey(pe.systems) === systemsKey(bv.suggested.systems);
    if (untouched && following && systemsKey(sv.suggested.systems) !== systemsKey(ev.systems)) {
      ev.systems = carry(sv.suggested.systems, pe.systems);
    }
  }
  return out;
}

function withVariant(edits: DesignEdits, variantId: string, fn: (v: DesignEdits["variants"][number]) => DesignEdits["variants"][number]): DesignEdits {
  return { ...edits, variants: edits.variants.map((v) => (v.id === variantId ? fn(clone(v)) : v)) };
}

export function setRoom(ctx: StudioCtx, edits: DesignEdits, roomId: string, patch: Partial<DesignEdits["rooms"][number]>): DesignEdits {
  const next = { ...edits, rooms: edits.rooms.map((r) => (r.roomId === roomId ? { ...r, ...patch } : r)) };
  return follow(ctx, edits, next);
}

export function setIndoor(ctx: StudioCtx, edits: DesignEdits, variantId: string, roomId: string, indoorItemId: string): DesignEdits {
  const next = withVariant(edits, variantId, (v) => ({ ...v, roomUnits: v.roomUnits.map((u) => (u.roomId === roomId ? { ...u, indoorItemId } : u)) }));
  return follow(ctx, edits, next);
}

/** Rebuild one option on another brand: the engine's units and arrangement for it. */
export function setManufacturer(ctx: StudioCtx, edits: DesignEdits, variantId: string, manufacturer: string): DesignEdits {
  const current = previewOf(ctx, edits);
  const variant = current.variants.find((v) => v.id === variantId);
  if (!variant) return edits;
  const choice = autoChoice(current.rooms, variant.tier, manufacturer || undefined, ctx.catalogue, ctx.compatibility);
  return withVariant(edits, variantId, (v) => ({
    ...v,
    ...(manufacturer ? { manufacturer } : {}),
    roomUnits: choice.roomUnits,
    systems: carry(choice.systems, v.systems),
  }));
}

/** Move a room to another outdoor unit (an index) or to its own new one. Changed groups get the engine's outdoor unit for them. */
export function assignRoom(ctx: StudioCtx, edits: DesignEdits, variantId: string, roomId: string, target: number | "new"): DesignEdits {
  const current = previewOf(ctx, edits);
  return withVariant(edits, variantId, (v) => {
    const from = v.systems.findIndex((s) => s.roomIds.includes(roomId));
    if (target !== "new" && target === from) return v;
    let systems = v.systems.map((s) => ({ ...s, roomIds: s.roomIds.filter((r) => r !== roomId) }));
    const touched = new Set<number>();
    if (target === "new") {
      systems.push({ outdoorItemId: "", roomIds: [roomId] });
      touched.add(systems.length - 1);
    } else if (systems[target]) {
      systems[target] = { ...systems[target]!, roomIds: [...systems[target]!.roomIds, roomId] };
      touched.add(target);
    }
    if (from >= 0) touched.add(from);
    systems = systems.map((s, i) => {
      if (!touched.has(i) || s.roomIds.length === 0) return s;
      const rooms = current.rooms.filter((r) => s.roomIds.includes(r.roomId));
      const auto = autoSystems(rooms, v.roomUnits, ctx.catalogue, ctx.compatibility);
      return auto.length === 1 && auto[0]!.outdoorItemId ? { ...s, outdoorItemId: auto[0]!.outdoorItemId } : s;
    });
    return { ...v, systems: systems.filter((s) => s.roomIds.length > 0) };
  });
}

export function setOutdoor(edits: DesignEdits, variantId: string, index: number, outdoorItemId: string): DesignEdits {
  return withVariant(edits, variantId, (v) => ({ ...v, systems: v.systems.map((s, i) => (i === index ? { ...s, outdoorItemId } : s)) }));
}

export function setPosition(edits: DesignEdits, variantId: string, index: number, outdoorPositionId: string): DesignEdits {
  return withVariant(edits, variantId, (v) => ({
    ...v,
    systems: v.systems.map((s, i) => (i === index ? { ...s, ...(outdoorPositionId ? { outdoorPositionId } : {}) } : s)),
  }));
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function toggleRoomPhoto(edits: DesignEdits, roomId: string, mediaId: string): DesignEdits {
  return { ...edits, rooms: edits.rooms.map((r) => (r.roomId === roomId ? { ...r, layoutMediaIds: toggle(r.layoutMediaIds, mediaId) } : r)) };
}

export function toggleSystemPhoto(edits: DesignEdits, variantId: string, index: number, mediaId: string): DesignEdits {
  return withVariant(edits, variantId, (v) => ({
    ...v,
    systems: v.systems.map((s, i) => (i === index ? { ...s, layoutMediaIds: toggle(s.layoutMediaIds ?? [], mediaId) } : s)),
  }));
}

export function takeSuggestedIndoor(ctx: StudioCtx, edits: DesignEdits, variantId: string, roomId: string): DesignEdits {
  const sug = previewOf(ctx, edits).variants.find((v) => v.id === variantId)?.suggested?.roomUnits.find((u) => u.roomId === roomId);
  return sug?.indoorItemId ? setIndoor(ctx, edits, variantId, roomId, sug.indoorItemId) : edits;
}

export function takeSuggestedSystems(ctx: StudioCtx, edits: DesignEdits, variantId: string): DesignEdits {
  const sug = previewOf(ctx, edits).variants.find((v) => v.id === variantId)?.suggested;
  if (!sug) return edits;
  return withVariant(edits, variantId, (v) => ({ ...v, systems: carry(sug.systems, v.systems) }));
}

export function setReason(edits: DesignEdits, field: string, reason: string): DesignEdits {
  return { ...edits, reasons: { ...edits.reasons, [field]: reason } };
}

/** Drop an option (at least one stays). */
export function dropVariant(edits: DesignEdits, variantId: string): DesignEdits {
  if (edits.variants.length <= 1) return edits;
  return { ...edits, variants: edits.variants.filter((v) => v.id !== variantId) };
}

/** Bring back an option the saved design has, as it was saved. */
export function restoreVariant(design: DesignRecord, edits: DesignEdits, variantId: string): DesignEdits {
  if (edits.variants.some((v) => v.id === variantId)) return edits;
  const saved = editsFromDesign(design).variants.find((v) => v.id === variantId);
  if (!saved) return edits;
  const order = design.variants.map((v) => v.id);
  return { ...edits, variants: [...edits.variants, saved].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) };
}

/** A plausible DesignEdits from local storage (shape only: the server validates properly). */
export function isEdits(x: unknown): x is DesignEdits {
  if (!x || typeof x !== "object") return false;
  const e = x as Partial<DesignEdits>;
  return Array.isArray(e.rooms) && Array.isArray(e.variants) && e.variants.length > 0 && typeof e.reasons === "object" && e.reasons !== null;
}
