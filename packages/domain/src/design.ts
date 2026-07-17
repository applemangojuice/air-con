import { estimateRoomLoadWatts, selectCapacityKw } from "./heatload.ts";
import type { BomLine } from "./operations.ts";
import type { PropertyIntel } from "./intelligence.ts";
import type { CapacityKw, Survey, SurveyRoom } from "./types.ts";

/**
 * The engineering brain: a Design Rules Engine followed by an Equipment
 * Selection Engine.
 *
 * The rules engine evaluates every property against a fixed set of
 * engineering checks before any kit is chosen. Each rule lands on one of
 * three lights:
 *
 *   pass    (green)  auto-approved, no human needed
 *   review  (amber)  an engineer glances at one specific thing
 *   fail    (red)    cannot determine from the data we hold
 *
 * Once the lights are known, equipment selection is deterministic: one
 * button, full spec. Engineers validate exceptions instead of designing
 * every install from scratch.
 *
 * Same contract as the rest of the domain: plain JSON in, plain JSON out,
 * no randomness, no clocks. Capacities, pipe limits and noise figures are
 * typical R32 wall-split numbers and get replaced by the chosen
 * manufacturer's datasheet values before real installs.
 */

export const DESIGN_ENGINE_VERSION = "2026.07.1";

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export interface DesignInput {
  survey: Survey;
  /** Property record when we hold one: planning constraints, EPC fabric. */
  intel?: PropertyIntel;
  /** People normally home. Nudges loads in living spaces. */
  occupants?: number;
  /** Bedrooms or close neighbours: bias unit choice and flag noise. */
  quietPriority?: boolean;
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export interface OutdoorModel {
  sku: string;
  label: string;
  capacityKw: number;
  /** Indoor units this outdoor can serve. 1 = single split. */
  ports: number;
  maxTotalPipeM: number;
  maxHeightDiffM: number;
  /** Refrigerant pre-charged for this much pipe. */
  prechargedPipeM: number;
  /** Additional charge beyond the pre-charge, grams per metre. */
  chargePerM: number;
  /** Sound power level, dB(A). Pressure at distance derives from this. */
  soundPowerDb: number;
  runningAmps: number;
}

/** Typical R32 wall-split range. Swap for the chosen manufacturer's list. */
export const OUTDOOR_RANGE: OutdoorModel[] = [
  { sku: "DIH-OU25", label: "2.5 kW single outdoor", capacityKw: 2.5, ports: 1, maxTotalPipeM: 20, maxHeightDiffM: 10, prechargedPipeM: 15, chargePerM: 20, soundPowerDb: 61, runningAmps: 6.5 },
  { sku: "DIH-OU35", label: "3.5 kW single outdoor", capacityKw: 3.5, ports: 1, maxTotalPipeM: 25, maxHeightDiffM: 12, prechargedPipeM: 15, chargePerM: 20, soundPowerDb: 62, runningAmps: 7.5 },
  { sku: "DIH-OU50", label: "5.0 kW single outdoor", capacityKw: 5.0, ports: 1, maxTotalPipeM: 30, maxHeightDiffM: 15, prechargedPipeM: 15, chargePerM: 20, soundPowerDb: 65, runningAmps: 11 },
  { sku: "DIH-OU71", label: "7.1 kW single outdoor", capacityKw: 7.1, ports: 1, maxTotalPipeM: 30, maxHeightDiffM: 15, prechargedPipeM: 15, chargePerM: 40, soundPowerDb: 68, runningAmps: 15 },
  { sku: "DIH-MU52", label: "5.2 kW multi outdoor (2 ports)", capacityKw: 5.2, ports: 2, maxTotalPipeM: 30, maxHeightDiffM: 15, prechargedPipeM: 20, chargePerM: 20, soundPowerDb: 65, runningAmps: 13 },
  { sku: "DIH-MU68", label: "6.8 kW multi outdoor (3 ports)", capacityKw: 6.8, ports: 3, maxTotalPipeM: 50, maxHeightDiffM: 15, prechargedPipeM: 30, chargePerM: 20, soundPowerDb: 66, runningAmps: 16 },
  { sku: "DIH-MU80", label: "8.0 kW multi outdoor (4 ports)", capacityKw: 8.0, ports: 4, maxTotalPipeM: 70, maxHeightDiffM: 15, prechargedPipeM: 30, chargePerM: 20, soundPowerDb: 68, runningAmps: 20 },
  { sku: "DIH-MU100", label: "10.0 kW multi outdoor (5 ports)", capacityKw: 10.0, ports: 5, maxTotalPipeM: 80, maxHeightDiffM: 15, prechargedPipeM: 30, chargePerM: 40, soundPowerDb: 70, runningAmps: 24 },
];

interface IndoorModel {
  sku: string;
  label: string;
  capacityKw: CapacityKw;
  /** Liquid / gas line outside diameters in mm (1/4" = 6.35 etc). */
  liquidMm: number;
  gasMm: number;
  /** Sound pressure on the lowest fan speed, dB(A) at 1 m. */
  soundDbLow: number;
  /** Flare nut torque range for the gas line, N·m. */
  torqueNm: { min: number; max: number };
}

export const INDOOR_RANGE: Record<string, IndoorModel> = {
  "2.5": { sku: "DIH-W25", label: "2.5 kW wall-mounted indoor", capacityKw: 2.5, liquidMm: 6.35, gasMm: 9.52, soundDbLow: 19, torqueNm: { min: 33, max: 42 } },
  "3.5": { sku: "DIH-W35", label: "3.5 kW wall-mounted indoor", capacityKw: 3.5, liquidMm: 6.35, gasMm: 9.52, soundDbLow: 20, torqueNm: { min: 33, max: 42 } },
  "5.0": { sku: "DIH-W50", label: "5.0 kW wall-mounted indoor", capacityKw: 5.0, liquidMm: 6.35, gasMm: 12.7, soundDbLow: 24, torqueNm: { min: 50, max: 62 } },
  "7.1": { sku: "DIH-W71", label: "7.1 kW wall-mounted indoor", capacityKw: 7.1, liquidMm: 9.52, gasMm: 15.88, soundDbLow: 27, torqueNm: { min: 63, max: 77 } },
};

/* ------------------------------------------------------------------ */
/* Route estimation                                                    */
/* ------------------------------------------------------------------ */

/** Estimated pipe run from the indoor unit to the outdoor position, metres. */
export function estimatePipeRunM(room: SurveyRoom): number {
  const byFloor: Record<SurveyRoom["floor"], number> = {
    ground: 4,
    first: 7,
    "second-plus": 10,
    loft: 12,
  };
  return byFloor[room.floor] + (room.hasExternalWall ? 0 : 4);
}

/** Vertical separation between the indoor unit and a ground-level outdoor. */
export function estimateHeightDiffM(room: SurveyRoom): number {
  const byFloor: Record<SurveyRoom["floor"], number> = {
    ground: 1,
    first: 4,
    "second-plus": 7,
    loft: 8,
  };
  return byFloor[room.floor];
}

/** Straight-line distance to the nearest neighbouring window, metres. */
function neighbourDistanceM(survey: Survey): number {
  const byType: Record<Survey["property"]["type"], number> = {
    detached: 8,
    "semi-detached": 5,
    terraced: 5,
    flat: 3,
    bungalow: 6,
  };
  const base = byType[survey.property.type];
  return survey.outdoor.location === "balcony" ? Math.min(base, 2) : base;
}

/**
 * Sound pressure at distance d from sound power Lw (hemispherical
 * spreading), minus a screening allowance for ground positions tucked
 * behind the building line, MCS 020 style.
 */
function soundPressureAt(soundPowerDb: number, distanceM: number, location: Survey["outdoor"]["location"]): number {
  const screening = location === "ground-rear" || location === "ground-side" ? 6 : 0;
  return Math.round(soundPowerDb - 8 - 20 * Math.log10(Math.max(1, distanceM)) - screening);
}

/* ------------------------------------------------------------------ */
/* The rules                                                           */
/* ------------------------------------------------------------------ */

export type RuleStatus = "pass" | "review" | "fail";

export interface RuleResult {
  id: string;
  title: string;
  status: RuleStatus;
  /** The evidence, with the numbers: what we checked and what we found. */
  detail: string;
}

export type DesignVerdict = "auto-approved" | "needs-review" | "cannot-determine";

export function designVerdict(rules: RuleResult[]): DesignVerdict {
  if (rules.some((r) => r.status === "fail")) return "cannot-determine";
  if (rules.some((r) => r.status === "review")) return "needs-review";
  return "auto-approved";
}

/** Noise limit at the nearest neighbouring window: permitted-development guidance. */
export const NOISE_LIMIT_DB = 42;

interface RuleContext {
  input: DesignInput;
  systems: SystemUnit[];
}

function evaluateRules(ctx: RuleContext): RuleResult[] {
  const { survey, intel } = ctx.input;
  const rules: RuleResult[] = [];
  const add = (id: string, title: string, status: RuleStatus, detail: string) =>
    rules.push({ id, title, status, detail });

  // 1. Topology: can one multi-split serve the whole home?
  const roomCount = survey.rooms.length;
  if (roomCount === 1) {
    add("topology", "System topology", "pass", "One room, one single-split. No multi-split gymnastics required.");
  } else if (ctx.systems.length === 1) {
    add(
      "topology",
      "System topology",
      "pass",
      `${roomCount} rooms fit one ${ctx.systems[0]!.outdoor.label} within its pipe allowance.`,
    );
  } else {
    add(
      "topology",
      "System topology",
      "review",
      `${roomCount} rooms exceed one outdoor unit's ports or pipe allowance, so the design splits across ${ctx.systems.length} outdoor units. Worth an engineer's eye on positioning.`,
    );
  }

  // 2. Pipe limits: total equivalent length + height difference per system.
  let worstPipe: RuleStatus = "pass";
  const pipeNotes: string[] = [];
  for (const sys of ctx.systems) {
    const limit = sys.outdoor.maxTotalPipeM;
    const usagePct = Math.round((sys.refrigerant.totalPipeM / limit) * 100);
    const heightOk = sys.maxHeightDiffM <= sys.outdoor.maxHeightDiffM;
    if (!heightOk || usagePct > 100) worstPipe = "fail";
    else if (usagePct > 85 && worstPipe === "pass") worstPipe = "review";
    pipeNotes.push(
      `${sys.outdoor.sku}: ${sys.refrigerant.totalPipeM} m of ${limit} m allowed (${usagePct}%), height diff ${sys.maxHeightDiffM} m of ${sys.outdoor.maxHeightDiffM} m.`,
    );
  }
  add("pipe-limits", "Pipe length & height limits", worstPipe, pipeNotes.join(" "));

  // 3. Electrical spare capacity.
  const elec = survey.electrics.condition;
  if (elec === "modern-spare-ways") {
    add("electrics", "Electrical spare capacity", "pass", "Modern consumer unit with spare ways. Dedicated circuit drops straight in.");
  } else if (elec === "modern-full") {
    add("electrics", "Electrical spare capacity", "review", "Modern board but no spare ways. A way needs freeing or a small board extension; priced, confirmed at the site visit.");
  } else if (elec === "older-fuse-box") {
    add("electrics", "Electrical spare capacity", "review", "Older fuse board. Dedicated circuit work is priced in; our electrician confirms the approach at the site visit.");
  } else {
    add("electrics", "Electrical spare capacity", "fail", "No fuse board photo yet, so spare capacity cannot be determined. One photo unlocks this rule.");
  }

  // 4. Planning & conservation constraints.
  if (!intel) {
    add("planning", "Planning constraints", "review", "No property record held yet. We check conservation and Article 4 layers before the site visit.");
  } else if (intel.constraints.listedBuilding) {
    add("planning", "Planning constraints", "review", "Listed building. Outdoor unit position needs consent-aware placement; a human signs this off.");
  } else if (intel.constraints.conservationArea || intel.constraints.article4) {
    add("planning", "Planning constraints", "review", "Conservation area or Article 4 direction applies. Rear or concealed outdoor positions keep this simple; we confirm placement.");
  } else {
    add("planning", "Planning constraints", "pass", "No conservation area, listing or Article 4 direction on record.");
  }

  // 5. Condensate drainage: gravity or pump, room by room.
  const pumped = ctx.systems.flatMap((s) => s.rooms).filter((r) => r.condensatePump);
  if (pumped.length === 0) {
    add("drainage", "Condensate drainage", "pass", "Every indoor unit gravity-drains through its external wall. No pumps, nothing to hum.");
  } else {
    add(
      "drainage",
      "Condensate drainage",
      "pass",
      `Gravity drainage where walls allow; condensate pumps specified for ${pumped.map((r) => r.roomName).join(", ")}. Deterministic, already in the kit list.`,
    );
  }

  // 6. Wall mounting: every indoor unit on an external wall as intended?
  const internal = survey.rooms.filter((r) => !r.hasExternalWall);
  if (internal.length === 0) {
    add("mounting", "Indoor unit mounting", "pass", "All indoor units mount on external walls as designed.");
  } else {
    add(
      "mounting",
      "Indoor unit mounting",
      "review",
      `${internal.map((r) => r.name).join(", ")}: no external wall, so the pipe route runs concealed to the nearest external point. Route needs a design check.`,
    );
  }

  // 7. Maintenance clearances around indoor and outdoor units.
  const loc = survey.outdoor.location;
  if (loc === "unsure") {
    add("clearances", "Service clearances", "fail", "Outdoor position undecided, so clearances cannot be determined. The site visit fixes this in minutes.");
  } else if (loc === "flat-roof") {
    add("clearances", "Service clearances", "review", "Flat-roof position: clearances are fine but safe access for servicing needs confirming.");
  } else if (loc === "balcony") {
    add("clearances", "Service clearances", "review", "Balcony position: airflow and service clearances are tight by nature. We confirm minimum distances at the site visit.");
  } else {
    add("clearances", "Service clearances", "pass", "Ground or bracket position with standard service clearances (300 mm rear, 600 mm front) achievable.");
  }

  // 8. Noise at the nearest neighbouring window.
  const distance = neighbourDistanceM(survey);
  const loudest = Math.max(...ctx.systems.map((s) => s.outdoor.soundPowerDb));
  const atWindow = soundPressureAt(loudest, distance, loc);
  const margin = NOISE_LIMIT_DB - atWindow;
  if (loc === "unsure") {
    add("noise", "Noise at nearest neighbour", "fail", "Cannot model noise without an outdoor position.");
  } else if (margin >= 3) {
    add("noise", "Noise at nearest neighbour", "pass", `Estimated ${atWindow} dB(A) at the nearest neighbouring window (${distance} m), inside the ${NOISE_LIMIT_DB} dB(A) guidance with ${margin} dB to spare.`);
  } else if (margin >= 0) {
    add("noise", "Noise at nearest neighbour", "review", `Estimated ${atWindow} dB(A) at ${distance} m sits within ${NOISE_LIMIT_DB} dB(A) guidance but with under 3 dB margin. Night mode or an acoustic tweak keeps neighbours friendly.`);
  } else {
    add("noise", "Noise at nearest neighbour", "review", `Estimated ${atWindow} dB(A) at ${distance} m exceeds the ${NOISE_LIMIT_DB} dB(A) guidance. Relocation, a quieter unit or an acoustic enclosure; an engineer picks.`);
  }

  return rules;
}

/* ------------------------------------------------------------------ */
/* Equipment selection                                                 */
/* ------------------------------------------------------------------ */

export interface RoomEquipment {
  roomId: string;
  roomName: string;
  loadWatts: number;
  capacityKw: CapacityKw;
  indoorSku: string;
  indoorLabel: string;
  /** Liquid / gas line diameters, mm. */
  liquidMm: number;
  gasMm: number;
  pipeRunM: number;
  /** Gas-line flare torque spec the installer must hit. */
  torqueNm: { min: number; max: number };
  condensatePump: boolean;
  trunkingM: number;
  interconnect: string;
}

export interface ElectricalSpec {
  runningAmps: number;
  supplyCableMm2: number;
  breaker: string;
  isolator: string;
  spurNote?: string;
}

export interface RefrigerantSpec {
  type: "R32";
  totalPipeM: number;
  prechargedPipeM: number;
  additionalChargeG: number;
}

export interface SystemUnit {
  topology: "single" | "multi";
  outdoor: OutdoorModel;
  mounting: string;
  rooms: RoomEquipment[];
  maxHeightDiffM: number;
  electrical: ElectricalSpec;
  refrigerant: RefrigerantSpec;
}

export interface SystemBlueprint {
  engineVersion: string;
  verdict: DesignVerdict;
  rules: RuleResult[];
  systems: SystemUnit[];
  bom: BomLine[];
  penetrations: number;
  totalPipeM: number;
  installDays: number;
}

const MOUNTING: Record<Survey["outdoor"]["location"], string> = {
  "ground-rear": "Ground level (rear), rubber anti-vibration feet on a level base",
  "ground-side": "Ground level (side), rubber anti-vibration feet on a level base",
  "wall-bracket": "Galvanised wall bracket with anti-vibration mounts",
  "flat-roof": "Flat-roof frame with anti-vibration mounts and walkway access",
  balcony: "Balcony floor mount with anti-vibration feet",
  unsure: "To be confirmed at the site visit",
};

function breakerFor(amps: number): { breaker: string; cableMm2: number } {
  const design = amps * 1.25;
  if (design <= 16) return { breaker: "16 A type-B RCBO", cableMm2: 2.5 };
  if (design <= 20) return { breaker: "20 A type-B RCBO", cableMm2: 2.5 };
  if (design <= 25) return { breaker: "25 A type-B RCBO", cableMm2: 4 };
  return { breaker: "32 A type-B RCBO", cableMm2: 6 };
}

function roomEquipment(room: SurveyRoom, occupants: number): RoomEquipment {
  let load = estimateRoomLoadWatts(room);
  // Extra bodies in social rooms: roughly 120 W sensible each above two.
  if ((room.type === "living-room" || room.type === "kitchen-diner") && occupants > 2) {
    load += (occupants - 2) * 120;
  }
  const capacity = selectCapacityKw(load);
  const model = INDOOR_RANGE[capacity.toFixed(1)]!;
  const runM = estimatePipeRunM(room);
  return {
    roomId: room.id,
    roomName: room.name,
    loadWatts: load,
    capacityKw: capacity,
    indoorSku: model.sku,
    indoorLabel: model.label,
    liquidMm: model.liquidMm,
    gasMm: model.gasMm,
    pipeRunM: runM,
    torqueNm: model.torqueNm,
    condensatePump: !room.hasExternalWall,
    trunkingM: Math.ceil(runM / 2),
    interconnect: "4-core 1.5 mm² interconnect cable",
  };
}

/** Smallest outdoor that serves these rooms within capacity and pipe limits. */
function pickOutdoor(rooms: RoomEquipment[], totalPipeM: number): OutdoorModel | undefined {
  const requiredKw = rooms.reduce((s, r) => s + r.capacityKw, 0) * (rooms.length > 1 ? 0.8 : 1);
  return OUTDOOR_RANGE.find(
    (m) =>
      m.ports >= rooms.length &&
      (rooms.length > 1 ? m.ports > 1 : m.ports === 1) &&
      m.capacityKw >= requiredKw - 0.05 &&
      m.maxTotalPipeM >= totalPipeM,
  );
}

function buildSystemUnit(rooms: RoomEquipment[], surveyRooms: SurveyRoom[], survey: Survey): SystemUnit {
  const totalPipeM = rooms.reduce((s, r) => s + r.pipeRunM, 0);
  const outdoor =
    pickOutdoor(rooms, totalPipeM) ?? OUTDOOR_RANGE[OUTDOOR_RANGE.length - 1]!;
  const maxHeightDiffM = Math.max(
    ...surveyRooms
      .filter((sr) => rooms.some((r) => r.roomId === sr.id))
      .map((sr) => estimateHeightDiffM(sr)),
  );
  const { breaker, cableMm2 } = breakerFor(outdoor.runningAmps);
  const additional = Math.max(0, totalPipeM - outdoor.prechargedPipeM) * outdoor.chargePerM;
  return {
    topology: rooms.length > 1 ? "multi" : "single",
    outdoor,
    mounting: MOUNTING[survey.outdoor.location],
    rooms,
    maxHeightDiffM,
    electrical: {
      runningAmps: outdoor.runningAmps,
      supplyCableMm2: cableMm2,
      breaker,
      isolator: "45 A weatherproof rotary isolator by the outdoor unit",
      spurNote:
        survey.electrics.condition === "older-fuse-box"
          ? "Dedicated circuit from a board upgrade (priced)"
          : survey.electrics.condition === "modern-full"
            ? "Consumer unit way freed or extended (priced)"
            : undefined,
    },
    refrigerant: {
      type: "R32",
      totalPipeM,
      prechargedPipeM: outdoor.prechargedPipeM,
      additionalChargeG: Math.round(additional),
    },
  };
}

/** Pipe kit stock lengths: round each run up to the next kit. */
function pipeKitLengthM(runM: number): number {
  return runM <= 5 ? 5 : runM <= 10 ? 10 : 15;
}

function buildBom(systems: SystemUnit[], survey: Survey, penetrations: number): BomLine[] {
  const lines = new Map<string, BomLine>();
  const add = (sku: string, label: string, qty = 1) => {
    const existing = lines.get(sku);
    if (existing) existing.qty += qty;
    else lines.set(sku, { sku, label, qty });
  };

  for (const sys of systems) {
    add(sys.outdoor.sku, sys.outdoor.label);
    if (survey.outdoor.location === "wall-bracket") add("ou-bracket", "Galvanised outdoor wall bracket + anti-vibration mounts");
    else if (survey.outdoor.location === "flat-roof") add("ou-roof-frame", "Flat-roof mounting frame + anti-vibration mounts");
    else add("ou-feet", "Ground mounting feet + anti-vibration pads");
    const cable = sys.electrical.supplyCableMm2;
    add(`cable-${cable}`, `${cable} mm² twin & earth supply run`);
    add(`rcbo-${sys.electrical.breaker.slice(0, 2)}`, sys.electrical.breaker);
    add("isolator-45", "45 A weatherproof rotary isolator");
    if (sys.refrigerant.additionalChargeG > 0) {
      add("r32-topup", `R32 additional charge (${sys.refrigerant.additionalChargeG} g)`);
    }
    for (const room of sys.rooms) {
      add(room.indoorSku, room.indoorLabel);
      add("iu-plate", "Indoor wall plate + fixings");
      const kit = pipeKitLengthM(room.pipeRunM);
      add(
        `pipe-${room.liquidMm}x${room.gasMm}-${kit}`,
        `${kit} m insulated pipe pair ${room.liquidMm} / ${room.gasMm} mm`,
      );
      add("interconnect", "4-core 1.5 mm² interconnect cable run");
      if (room.condensatePump) add("condensate-pump", "Mini condensate pump");
      else add("condensate-kit", "Gravity condensate drain kit");
      add("trunking", "Trunking pack (3 m)", Math.max(1, Math.ceil(room.trunkingM / 3)));
    }
  }
  add("wall-sleeve", "Wall sleeve + fire-stopping collar", penetrations);
  add("consumables", "Consumables box (fixings, sealant, UV tape, labels)");
  return [...lines.values()];
}

/**
 * One button: Design System.
 *
 * Runs the rules, sizes every room, picks the kit, and returns a complete
 * buildable specification with its traffic-light verdict.
 */
export function designSystem(input: DesignInput): SystemBlueprint {
  const { survey } = input;
  const occupants = input.occupants ?? survey.property.bedrooms + 1;
  const equipment = survey.rooms.map((r) => roomEquipment(r, occupants));

  // Try one multi-split first; split across outdoor units when ports or
  // pipe allowances say no. Biggest loads spread first, same as pricing.
  let groups: RoomEquipment[][];
  if (equipment.length === 1) {
    groups = [equipment];
  } else {
    const single = pickOutdoor(
      equipment,
      equipment.reduce((s, r) => s + r.pipeRunM, 0),
    );
    if (single) {
      groups = [equipment];
    } else {
      const sorted = [...equipment].sort((a, b) => b.capacityKw - a.capacityKw);
      const groupCount = Math.ceil(sorted.length / 4);
      groups = Array.from({ length: Math.max(2, groupCount) }, () => []);
      sorted.forEach((room, i) => groups[i % groups.length]!.push(room));
    }
  }

  const systems = groups.map((g) => buildSystemUnit(g, survey.rooms, survey));
  const penetrations = survey.rooms.length + (survey.rooms.some((r) => !r.hasExternalWall) ? 1 : 0);
  const rules = evaluateRules({ input, systems });
  const totalPipeM = systems.reduce((s, sys) => s + sys.refrigerant.totalPipeM, 0);
  const indoorCount = survey.rooms.length;

  return {
    engineVersion: DESIGN_ENGINE_VERSION,
    verdict: designVerdict(rules),
    rules,
    systems,
    bom: buildBom(systems, survey, penetrations),
    penetrations,
    totalPipeM,
    installDays: Math.max(1, Math.ceil((indoorCount * 0.5 + 0.5) * 2) / 2),
  };
}
