import { buildDefaultConfig, type SurveyRoom } from "@aircon/domain";
import type { QuoteDraft } from "./quote-draft";

/**
 * Which rooms are priced, in one place (pure, so it's tested): the rooms
 * the house answers generate, minus the ones the customer has said no to,
 * plus any they added. The guide-price card and the "Your home" page both
 * change rooms through these, so a room switched off on one is off on the
 * other, and stays off when the bedrooms or layout change.
 */

export function configFor(d: QuoteDraft) {
  const p = d.survey.property;
  return buildDefaultConfig({
    type: p.type,
    era: p.era,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms ?? 1,
    layout: d.layout,
    floorAreaM2: p.floorAreaM2,
  });
}

/** A room they added themselves (generated rooms have "default-" ids). */
const custom = (r: SurveyRoom) => !r.id.startsWith("default-");

/**
 * Rooms, outdoor position and install pattern from the house answers. Rooms
 * they switched off stay off (by name), rooms they added stay, and photos
 * already taken for a room of the same name are kept.
 */
export function configure(d: QuoteDraft): QuoteDraft {
  const config = configFor(d);
  const declined = new Set((d.declinedRooms ?? []).map((r) => r.name));
  const photos = new Map([...d.survey.rooms, ...(d.declinedRooms ?? [])].map((r) => [r.name, r.photos]));
  const generated = config.rooms.map((r) => ({ ...r, photos: photos.get(r.name) ?? r.photos }));
  return {
    ...d,
    configured: true,
    declinedRooms: [...generated.filter((r) => declined.has(r.name)), ...(d.declinedRooms ?? []).filter(custom)],
    survey: {
      ...d.survey,
      archetypeId: config.archetypeId,
      permutationId: config.permutationId,
      rooms: [...generated.filter((r) => !declined.has(r.name)), ...d.survey.rooms.filter(custom)],
      outdoor: { ...d.survey.outdoor, location: config.outdoorDefault },
    },
  };
}

/** Switch a room off: it leaves the price but stays on the list to switch back on. */
export function declineRoom(d: QuoteDraft, roomId: string): QuoteDraft {
  const room = d.survey.rooms.find((r) => r.id === roomId);
  if (!room) return d;
  return {
    ...d,
    declinedRooms: [...(d.declinedRooms ?? []), room],
    survey: { ...d.survey, rooms: d.survey.rooms.filter((r) => r.id !== roomId) },
  };
}

/** Switch a room back on, where it was. */
export function includeRoom(d: QuoteDraft, roomId: string): QuoteDraft {
  const room = (d.declinedRooms ?? []).find((r) => r.id === roomId);
  if (!room) return d;
  const order = displayOrder(d);
  const rooms = [...d.survey.rooms, room].sort((a, b) => order(a) - order(b));
  return {
    ...d,
    declinedRooms: (d.declinedRooms ?? []).filter((r) => r.id !== roomId),
    survey: { ...d.survey, rooms },
  };
}

/**
 * Every room on the list, on or off, in a stable order (the generated order,
 * then any they added), so switching one off doesn't make it jump.
 */
export function allRooms(d: QuoteDraft): { room: SurveyRoom; included: boolean }[] {
  const order = displayOrder(d);
  return [
    ...d.survey.rooms.map((room) => ({ room, included: true })),
    ...(d.declinedRooms ?? []).map((room) => ({ room, included: false })),
  ].sort((a, b) => order(a.room) - order(b.room));
}

function displayOrder(d: QuoteDraft): (r: SurveyRoom) => number {
  const names = configFor(d).rooms.map((r) => r.name);
  const added = [...d.survey.rooms, ...(d.declinedRooms ?? [])].filter(custom).map((r) => r.id);
  return (r) => {
    const i = names.indexOf(r.name);
    return i >= 0 && !custom(r) ? i : names.length + Math.max(0, added.indexOf(r.id));
  };
}

/**
 * One more bedroom: the one they switched off, if any; otherwise another
 * bedroom on the house answers (up to six), laid out again.
 */
export function addBedroom(d: QuoteDraft): QuoteDraft {
  const off = (d.declinedRooms ?? []).find((r) => r.type === "bedroom");
  if (off) return includeRoom(d, off.id);
  const p = d.survey.property;
  if (p.bedrooms >= 6) return d;
  return configure({ ...d, survey: { ...d.survey, property: { ...p, bedrooms: p.bedrooms + 1 } } });
}

/** One more living room: the one they switched off, if any; otherwise a second living room. */
export function addLivingRoom(d: QuoteDraft): QuoteDraft {
  const off = (d.declinedRooms ?? []).find((r) => r.type === "living-room" || /living/i.test(r.name));
  if (off) return includeRoom(d, off.id);
  if (d.layout === "two-receptions") return d;
  return configure({ ...d, layout: "two-receptions" });
}

/** Can another living room be added from the card? */
export function canAddLivingRoom(d: QuoteDraft): boolean {
  return d.layout !== "two-receptions" || (d.declinedRooms ?? []).some((r) => r.type === "living-room");
}

/** The rooms the generator would make that aren't priced: on resume, those are the ones they switched off. */
export function declinedFromSaved(d: QuoteDraft): SurveyRoom[] {
  const priced = new Set(d.survey.rooms.map((r) => r.name));
  return configFor(d).rooms.filter((r) => !priced.has(r.name));
}

const a = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/**
 * "3 bedrooms, a kitchen and a living room": the priced rooms in a phrase,
 * for the guide-price card. Open-plan reads as one space; anything else
 * they added is named as they named it.
 */
export function roomsPhrase(rooms: readonly SurveyRoom[]): string {
  const count = (pred: (r: SurveyRoom) => boolean) => rooms.filter(pred).length;
  const openPlan = (r: SurveyRoom) => r.type === "kitchen-diner" && /open-plan/i.test(r.name);
  const parts: string[] = [];
  const beds = count((r) => r.type === "bedroom");
  if (beds) parts.push(a(beds, "1 bedroom", "bedrooms"));
  const open = count(openPlan);
  if (open) parts.push(a(open, "an open-plan kitchen and living area", "open-plan kitchen and living areas"));
  const kitchens = count((r) => r.type === "kitchen-diner" && !openPlan(r));
  if (kitchens) parts.push(a(kitchens, "a kitchen", "kitchens"));
  const living = count((r) => r.type === "living-room");
  if (living) parts.push(a(living, "a living room", "living rooms"));
  for (const r of rooms) {
    if (r.type === "bedroom" || r.type === "kitchen-diner" || r.type === "living-room") continue;
    parts.push(`the ${r.name.toLowerCase()}`);
  }
  if (parts.length === 0) return "no rooms yet";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
