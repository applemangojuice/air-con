import { buildDefaultConfig } from "@aircon/domain";
import { examplePrices } from "@/lib/example-prices";

/**
 * Guide prices for typical homes, with the rooms each one actually includes.
 * The engine leaves small box rooms out of its default layouts, so "a 3-bed
 * home" isn't always three bedrooms' worth: saying which rooms keeps the
 * comparison honest. Prices come from the same engine as a real quote.
 */

export interface ExampleHome {
  label: string;
  price: number;
  rooms: string[];
}

function roomsFor(type: "terraced" | "semi-detached", era: "pre-1930" | "1930-1950", bedrooms: number): string[] {
  return buildDefaultConfig({ type, era, bedrooms, bathrooms: 1, layout: "separate" }).rooms.map((r) => r.name);
}

export function exampleHomes(): ExampleHome[] {
  const p = examplePrices();
  return [
    { label: "One bedroom", price: p.oneBedroom, rooms: ["Bedroom"] },
    { label: "One living room", price: p.livingRoom, rooms: ["Living room"] },
    { label: "Bedroom and living room", price: p.twoRooms, rooms: ["Bedroom", "Living room"] },
    { label: "3-bed Victorian terrace", price: p.threeBedTerrace, rooms: roomsFor("terraced", "pre-1930", 3) },
    { label: "3-bed 1930s semi", price: p.threeBedSemi, rooms: roomsFor("semi-detached", "1930-1950", 3) },
    { label: "4-bed Victorian terrace", price: p.fourBedHome, rooms: roomsFor("terraced", "pre-1930", 4) },
  ];
}

/** "4 rooms: living room, kitchen, main bedroom and bedroom 2". */
export function roomsSummary(rooms: string[]): string {
  const names = rooms.map((r, i) => (i === 0 ? r : r.toLowerCase()));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
  return rooms.length > 2 ? `${rooms.length} rooms: ${list}` : list;
}

/** The cheapest typical whole-home example, for "from" anchors: its price and room count. */
export function homeAnchor(): { price: number; rooms: number } {
  const homes = exampleHomes().slice(3);
  const cheapest = homes.reduce((a, b) => (b.price < a.price ? b : a));
  return { price: cheapest.price, rooms: cheapest.rooms.length };
}
