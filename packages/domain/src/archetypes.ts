import type {
  FloorLevel,
  OutdoorLocation,
  PropertyEra,
  PropertyType,
  RoomSize,
  RoomType,
  SurveyRoom,
} from "./types.ts";

/**
 * The archetype library: the constraint that makes fixed pricing possible.
 *
 * Like fibre roll-outs that only serve certain postcodes, we only install a
 * small set of proven permutations per house type. The customer picks the
 * archetype that matches their home, then picks (or is defaulted into) one of
 * its install permutations. Design becomes selection, not invention.
 *
 * Each permutation is a pre-engineered install pattern: where the outdoor
 * unit lives, how pipes route, how many indoor units it can serve, and what
 * it adds to the base price. As install data accumulates (Phase 10), each
 * permutation accretes real labour times and issue rates.
 */

export interface InstallPermutation {
  id: string;
  label: string;
  /** Customer-facing one-liner shown at selection time. */
  summary: string;
  outdoorLocation: OutdoorLocation;
  /** Max indoor units this pattern serves before a second outdoor unit is needed. */
  servesUpTo: number;
  /** How the pipework runs, shown to the customer as "how we install". */
  pipeRoute: string;
  /** Added to the engine's base price for this pattern's extra work. */
  adderGbp: number;
  /** Constraints ops must check on the video/photos before confirming. */
  checks: string[];
}

/** A room in the archetype's stock floor plan, the zero-AI capture path. */
export interface RoomPreset {
  name: string;
  type: RoomType;
  size: RoomSize;
  floor: FloorLevel;
  /** Rooms most customers cool, pre-ticked in the picker. */
  popular?: boolean;
}

export interface HouseArchetype {
  id: string;
  name: string;
  /** e.g. "1930–1955" */
  eraLabel: string;
  /** Customer-facing description used for self-identification. */
  description: string;
  /** "You probably live in one if…" recognisers. */
  recognisers: string[];
  matches: { types: PropertyType[]; eras: PropertyEra[] };
  /**
   * The stock floor plan: because we only serve known house types, we know
   * their typical rooms. Customers confirm and tweak instead of describing,
   * no transcription or extraction needed.
   */
  typicalRooms: RoomPreset[];
  permutations: InstallPermutation[];
}

const r = (
  name: string,
  type: RoomType,
  size: RoomSize,
  floor: FloorLevel,
  popular = false,
): RoomPreset => ({ name, type, size, floor, popular });

const p = (
  id: string,
  label: string,
  summary: string,
  outdoorLocation: OutdoorLocation,
  servesUpTo: number,
  pipeRoute: string,
  adderGbp: number,
  checks: string[],
): InstallPermutation => ({ id, label, summary, outdoorLocation, servesUpTo, pipeRoute, adderGbp, checks });

export const ARCHETYPES: HouseArchetype[] = [
  {
    id: "victorian-terrace",
    name: "Victorian terrace",
    eraLabel: "1850–1910",
    description:
      "Two-storey brick terrace with a rear kitchen outrigger and a small back yard or garden.",
    recognisers: ["Bay window at the front", "Rear addition/outrigger", "Solid brick walls", "Alley or yard access at the back"],
    matches: { types: ["terraced"], eras: ["pre-1930"] },
    typicalRooms: [
      r("Front reception", "living-room", "large", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "medium", "ground"),
      r("Main bedroom", "bedroom", "medium", "first", true),
      r("Bedroom 2", "bedroom", "medium", "first"),
      r("Box room / office", "home-office", "small", "first"),
    ],
    permutations: [
      p("rear-yard-multi", "Rear yard multi-split", "One outdoor unit in the back yard serving up to 4 rooms through the rear wall.", "ground-rear", 4,
        "Condensate and refrigerant lines drop down the rear elevation in discreet trunking; bedrooms served via the outrigger junction.", 0,
        ["Rear access route", "Outrigger wall condition", "Yard drainage for condensate"]),
      p("rear-wall-bracket", "Rear wall bracket", "Outdoor unit bracket-mounted on the rear wall where the yard is too small.", "wall-bracket", 3,
        "Unit sits above head height on the outrigger return; short pipe runs to rear rooms.", 150,
        ["Solid brick fixing points", "Neighbour proximity / noise", "Working-at-height access"]),
      p("front-room-single", "Single room (rear only)", "One system for a single room. We don't route to the front in terraces at a fixed price.", "ground-rear", 1,
        "Straight drop through the rear wall to the yard unit.", 0,
        ["Room has a rear-facing or gable external wall"]),
    ],
  },
  {
    id: "edwardian-semi",
    name: "Edwardian semi / villa",
    eraLabel: "1900–1929",
    description: "Generous semi with high ceilings, bay windows, side return and solid walls.",
    recognisers: ["High ceilings (2.7 m+)", "Side return or passage", "Timber sash windows"],
    matches: { types: ["semi-detached", "detached"], eras: ["pre-1930"] },
    typicalRooms: [
      r("Living room", "living-room", "large", "ground", true),
      r("Dining room", "other", "medium", "ground"),
      r("Kitchen-diner", "kitchen-diner", "large", "ground"),
      r("Main bedroom", "bedroom", "large", "first", true),
      r("Bedroom 2", "bedroom", "medium", "first"),
      r("Bedroom 3", "bedroom", "small", "first"),
    ],
    permutations: [
      p("side-return-multi", "Side return multi-split", "Outdoor unit in the side return serving up to 4 rooms via a vertical riser.", "ground-side", 4,
        "A single tidy riser up the side elevation feeds front and rear rooms on both floors.", 0,
        ["Side passage width ≥ 700 mm", "Riser route clear of soil stacks", "Party-wall noise clearance"]),
      p("rear-garden-multi", "Rear garden multi-split", "Outdoor unit on a base in the back garden, pipes along the rear elevation.", "ground-rear", 4,
        "Rear elevation runs in trunking colour-matched to the render or brick.", 0,
        ["Garden base position ≥ 300 mm from wall", "Rear elevation window layout"]),
    ],
  },
  {
    id: "thirties-semi",
    name: "1930s semi",
    eraLabel: "1930–1955",
    description:
      "The classic three-bed semi: bay front, two storeys, side passage or garage, decent rear garden.",
    recognisers: ["Curved or square front bay", "Side passage or attached garage", "Early cavity walls"],
    matches: { types: ["semi-detached"], eras: ["1930-1950"] },
    typicalRooms: [
      r("Living room", "living-room", "large", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "medium", "ground"),
      r("Main bedroom", "bedroom", "medium", "first", true),
      r("Bedroom 2", "bedroom", "medium", "first"),
      r("Box room / office", "home-office", "small", "first"),
    ],
    permutations: [
      p("side-passage-multi", "Side passage multi-split", "Outdoor unit beside the house serving up to 4 rooms. Our most-fitted pattern.", "ground-side", 4,
        "Vertical riser on the side elevation; short ceiling-void spurs to front and rear bedrooms.", 0,
        ["Passage width", "Boiler flue clearance", "Riser fixing into cavity wall"]),
      p("rear-patio-multi", "Rear patio multi-split", "Outdoor unit on the patio; living spaces served directly, bedrooms via the rear wall.", "ground-rear", 4,
        "Ground-floor rooms take direct drops; first floor served by one rear riser.", 0,
        ["Patio position vs. seating area", "Condensate fall to drain"]),
      p("garage-roof", "Garage flat-roof mount", "Outdoor unit on the attached garage roof, out of sight from the garden.", "flat-roof", 4,
        "Short runs across the garage roof into the flank wall.", 340,
        ["Garage roof condition and load", "Safe access for servicing"]),
    ],
  },
  {
    id: "interwar-terrace",
    name: "1930s terrace",
    eraLabel: "1930–1955",
    description: "Two-storey brick terrace with a small front garden and a longer rear garden.",
    recognisers: ["Uniform street of matching houses", "Rear kitchen addition", "Shared side alleys every few houses"],
    matches: { types: ["terraced"], eras: ["1930-1950"] },
    typicalRooms: [
      r("Living room", "living-room", "large", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "medium", "ground"),
      r("Main bedroom", "bedroom", "medium", "first", true),
      r("Bedroom 2", "bedroom", "small", "first"),
    ],
    permutations: [
      p("rear-garden-multi", "Rear garden multi-split", "Outdoor unit at the rear serving up to 4 rooms through the back wall.", "ground-rear", 4,
        "Rear elevation riser with trunked drops to each room.", 0,
        ["Rear access (through-house or alley)", "Garden unit position"]),
      p("rear-wall-bracket", "Rear wall bracket", "Bracket-mounted at the rear where garden space is tight.", "wall-bracket", 3,
        "Above the kitchen addition roof line; short runs to bedrooms.", 150,
        ["Fixing substrate", "Neighbour windows within 3 m"]),
    ],
  },
  {
    id: "postwar-council",
    name: "Post-war ex-council house",
    eraLabel: "1945–1970",
    description: "Solidly built semi or terrace with wide frontage, generous rooms and big gardens.",
    recognisers: ["Wide window openings", "Rendered or pebble-dashed walls", "Large front and rear gardens"],
    matches: { types: ["semi-detached", "terraced"], eras: ["1930-1950"] },
    typicalRooms: [
      r("Living room", "living-room", "large", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "large", "ground"),
      r("Main bedroom", "bedroom", "medium", "first", true),
      r("Bedroom 2", "bedroom", "medium", "first"),
      r("Bedroom 3", "bedroom", "small", "first"),
    ],
    permutations: [
      p("rear-garden-multi", "Rear garden multi-split", "Outdoor unit at the rear; simple runs through rendered cavity walls.", "ground-rear", 4,
        "Straightforward rear riser. These houses are our fastest installs.", 0,
        ["Render condition at drill points"]),
      p("gable-side-multi", "Gable end multi-split", "Outdoor unit against the gable end serving both floors.", "ground-side", 4,
        "Gable riser with roomside spurs; keeps the garden elevation clean.", 0,
        ["Gable access", "Path width for servicing"]),
    ],
  },
  {
    id: "sixties-bungalow",
    name: "Bungalow",
    eraLabel: "1955–1985",
    description: "Single-storey with a loft, easy access all round and short pipe runs everywhere.",
    recognisers: ["Everything on one floor", "Shallow-pitch roof", "Driveway to the side"],
    matches: { types: ["bungalow"], eras: ["1930-1950", "1950-2000"] },
    typicalRooms: [
      r("Living room", "living-room", "large", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "medium", "ground"),
      r("Main bedroom", "bedroom", "medium", "ground", true),
      r("Bedroom 2", "bedroom", "small", "ground"),
    ],
    permutations: [
      p("rear-multi", "Rear multi-split", "One outdoor unit at the rear serving up to 4 rooms. Bungalows are made for this.", "ground-rear", 4,
        "Short horizontal runs at eaves level or through the loft to each room.", 0,
        ["Loft access for runs", "Eaves height"]),
      p("side-single-pair", "Side singles", "One or two single-splits on the flank wall for just the rooms you use.", "ground-side", 2,
        "Direct through-wall installs, often done before lunch.", 0,
        ["Flank wall space"]),
    ],
  },
  {
    id: "seventies-detached",
    name: "1960s–70s detached",
    eraLabel: "1960–1980",
    description: "Boxy detached with attached garage, shallow roof and generous plot.",
    recognisers: ["Integral or attached garage", "Large landing window", "Timber cladding panels"],
    matches: { types: ["detached"], eras: ["1930-1950"] },
    typicalRooms: [
      r("Living room", "living-room", "large", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "xl", "ground"),
      r("Home office", "home-office", "small", "ground"),
      r("Main bedroom", "bedroom", "large", "first", true),
      r("Bedroom 2", "bedroom", "medium", "first"),
      r("Bedroom 3", "bedroom", "small", "first"),
    ],
    permutations: [
      p("garage-side-multi", "Garage-side multi-split", "Outdoor unit beside the garage; runs enter through the garage for a clean look.", "ground-side", 4,
        "Pipework crosses the garage ceiling then rises to the bedrooms. Almost nothing visible outside.", 0,
        ["Garage internal route", "Fire-separation ceiling penetrations"]),
      p("rear-patio-multi", "Rear patio multi-split", "Classic rear installation serving living spaces and bedrooms.", "ground-rear", 4,
        "Rear riser with trunked spurs.", 0,
        ["Patio drainage"]),
    ],
  },
  {
    id: "townhouse",
    name: "Townhouse (3 storeys)",
    eraLabel: "1965–present",
    description: "Narrow-fronted three-storey home, often with an integral garage on the ground floor.",
    recognisers: ["Three floors", "Integral garage", "Small rear garden or courtyard"],
    matches: { types: ["terraced", "semi-detached"], eras: ["1930-1950", "1950-2000", "2000+"] },
    typicalRooms: [
      r("Living room", "living-room", "large", "first", true),
      r("Kitchen-diner", "kitchen-diner", "medium", "ground"),
      r("Home office", "home-office", "small", "ground"),
      r("Main bedroom", "bedroom", "medium", "second-plus", true),
      r("Bedroom 2", "bedroom", "medium", "second-plus"),
    ],
    permutations: [
      p("courtyard-multi", "Courtyard multi-split", "Outdoor unit in the rear courtyard with a full-height riser.", "ground-rear", 4,
        "One riser serves all three floors; top-floor rooms need the longest runs (priced in).", 220,
        ["Riser fixing at height", "Scaffold or tower access for floor 3"]),
      p("garage-internal", "Garage-fed system", "Outdoor unit outside the garage; pipework distributed internally.", "ground-side", 3,
        "Runs rise inside a boxed corner from the garage. Nothing on the front of the house.", 180,
        ["Internal boxing route agreed", "Garage wall penetrations"]),
    ],
  },
  {
    id: "eighties-estate",
    name: "1980s–90s estate house",
    eraLabel: "1980–1999",
    description: "Developer-built detached or link-detached on an estate; brick with concrete tile roof.",
    recognisers: ["Estate cul-de-sac", "Integral garage", "uPVC windows from new"],
    matches: { types: ["detached", "semi-detached"], eras: ["1950-2000"] },
    typicalRooms: [
      r("Living room", "living-room", "large", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "medium", "ground"),
      r("Main bedroom", "bedroom", "medium", "first", true),
      r("Bedroom 2", "bedroom", "medium", "first"),
      r("Bedroom 3", "bedroom", "small", "first"),
    ],
    permutations: [
      p("rear-multi", "Rear multi-split", "Outdoor unit at the rear; insulated cavity walls make for tidy, quick drills.", "ground-rear", 4,
        "Rear riser plus loft spurs to front bedrooms.", 0,
        ["Loft insulation depth at spur route"]),
      p("side-multi", "Side multi-split", "Outdoor unit on the flank keeps the garden elevation clear.", "ground-side", 4,
        "Flank riser; loft distribution to both sides.", 0,
        ["Path width", "Meter box clearance"]),
    ],
  },
  {
    id: "new-build-house",
    name: "New build (2000+)",
    eraLabel: "2000–present",
    description: "Modern developer home with high insulation. Smaller units cool it easily.",
    recognisers: ["NHBC-era build", "Trickle vents", "Small but well-insulated rooms"],
    matches: { types: ["detached", "semi-detached", "terraced"], eras: ["2000+"] },
    typicalRooms: [
      r("Living room", "living-room", "medium", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "large", "ground"),
      r("Main bedroom", "bedroom", "medium", "first", true),
      r("Bedroom 2", "bedroom", "small", "first"),
      r("Home office", "home-office", "small", "first"),
    ],
    permutations: [
      p("rear-multi", "Rear multi-split", "Outdoor unit at the rear; downsized units thanks to insulation levels.", "ground-rear", 4,
        "Rear riser; runs sized for low loads.", 0,
        ["Developer render/brick warranty at penetrations", "Estate covenant check"]),
      p("side-gable-multi", "Gable multi-split", "Flank-wall unit placement to satisfy estate covenants about visible kit.", "ground-side", 4,
        "Gable riser out of street view.", 0,
        ["Management-company rules", "Gable access"]),
    ],
  },
  {
    id: "low-rise-flat",
    name: "Flat with balcony (low rise)",
    eraLabel: "any era",
    description: "Purpose-built flat up to ~4 storeys with its own balcony or terrace.",
    recognisers: ["Own balcony/terrace", "Communal entrance", "Up to 4 storeys"],
    matches: { types: ["flat"], eras: ["1930-1950", "1950-2000", "2000+"] },
    typicalRooms: [
      r("Open-plan living/kitchen", "living-room", "large", "ground", true),
      r("Main bedroom", "bedroom", "medium", "ground", true),
      r("Bedroom 2", "bedroom", "small", "ground"),
    ],
    permutations: [
      p("balcony-single", "Balcony single-split", "Compact outdoor unit on your balcony serving the living space.", "balcony", 1,
        "Short run from the balcony through the external wall. Minimal disruption.", 120,
        ["Freeholder/management consent", "Balcony load and drainage"]),
      p("balcony-twin", "Balcony twin", "Balcony unit serving living room + one bedroom.", "balcony", 2,
        "Trunked run along the balcony soffit to the second room.", 220,
        ["Consent covers two penetrations", "Neighbour noise line-of-sight"]),
    ],
  },
  {
    id: "converted-flat",
    name: "Converted flat",
    eraLabel: "Victorian/Edwardian conversion",
    description: "A flat carved out of a period house. Solid walls, shared garden, freeholder consent needed.",
    recognisers: ["Period features", "Entrance hall shared with 1–3 flats", "Garden flat or upper maisonette"],
    matches: { types: ["flat"], eras: ["pre-1930"] },
    typicalRooms: [
      r("Living room", "living-room", "large", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "medium", "ground"),
      r("Main bedroom", "bedroom", "medium", "ground", true),
      r("Bedroom 2", "bedroom", "small", "ground"),
    ],
    permutations: [
      p("garden-single", "Garden flat single/multi", "Ground-floor flats: outdoor unit in your garden section, up to 3 rooms.", "ground-rear", 3,
        "Rear elevation runs as per a terrace install.", 0,
        ["Demised garden ownership", "Freeholder consent"]),
      p("upper-bracket", "Upper flat wall bracket", "Upper flats: bracket below your own window line where consent allows.", "wall-bracket", 2,
        "Bracket-mounted below sill level; short internal runs.", 340,
        ["Freeholder consent", "Working-at-height plan", "Structural fixing survey"]),
    ],
  },
  {
    id: "cottage",
    name: "Cottage / stone rural",
    eraLabel: "pre-1930",
    description: "Solid stone or thick brick walls, small windows, often detached with outside space.",
    recognisers: ["Walls 40 cm+ thick", "Small windows", "Rural or village setting"],
    matches: { types: ["detached", "terraced"], eras: ["pre-1930"] },
    typicalRooms: [
      r("Living room", "living-room", "medium", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "medium", "ground"),
      r("Main bedroom", "bedroom", "medium", "first", true),
      r("Bedroom 2", "bedroom", "small", "first"),
    ],
    permutations: [
      p("rear-single-pair", "Rear singles", "One or two single-splits where wall depth allows a clean core drill.", "ground-rear", 2,
        "Longer core drills through stone are priced in; runs kept short.", 280,
        ["Wall construction at drill point", "Listed-building status"]),
      p("outbuilding-feed", "Outbuilding-side unit", "Outdoor unit against an outbuilding or garden wall to protect the cottage's look.", "ground-side", 3,
        "Buried or wall-run lines from the outbuilding to the house.", 480,
        ["Trench route", "Distance ≤ 15 m"]),
    ],
  },
  {
    id: "high-rise-flat",
    name: "Flat without balcony / high rise",
    eraLabel: "any era",
    description:
      "A flat with no balcony or above the 4th floor. Usually not one we can do at a fixed price.",
    recognisers: ["No private outside space", "Above 4th floor"],
    matches: { types: ["flat"], eras: ["1930-1950", "1950-2000", "2000+"] },
    typicalRooms: [
      r("Open-plan living/kitchen", "living-room", "large", "ground", true),
      r("Main bedroom", "bedroom", "medium", "ground"),
    ],
    permutations: [
      p("survey-required", "Bespoke survey required", "We can sometimes use plant decks or communal areas, but that needs a proper survey rather than an instant price.", "unsure", 2,
        "Depends entirely on building management and crane/lift access.", 0,
        ["Building management engagement", "Plant deck availability"]),
    ],
  },
  {
    id: "barn-conversion",
    name: "Barn / unusual conversion",
    eraLabel: "converted",
    description: "Converted barn, chapel, school or other one-off. High spaces, unusual construction.",
    recognisers: ["Double-height spaces", "Exposed beams", "One-off construction"],
    matches: { types: ["detached"], eras: ["pre-1930", "1930-1950", "1950-2000", "2000+"] },
    typicalRooms: [
      r("Open-plan living space", "living-room", "xl", "ground", true),
      r("Kitchen-diner", "kitchen-diner", "large", "ground"),
      r("Main bedroom", "bedroom", "large", "first", true),
      r("Bedroom 2", "bedroom", "medium", "first"),
      r("Mezzanine office", "home-office", "small", "first"),
    ],
    permutations: [
      p("ground-multi", "Ground-level multi-split", "Outdoor unit at ground level; high-wall or floor-console indoor units for tall spaces.", "ground-rear", 4,
        "Runs follow beam lines in agreed routes; every install is photographed for the design library.", 380,
        ["Beam fixing approvals", "Ceiling height vs. throw distance"]),
    ],
  },
];

/** Rank archetypes by how well they match the property answers (best first). */
export function suggestArchetypes(property: {
  type: PropertyType;
  era: PropertyEra;
}): HouseArchetype[] {
  const scored = ARCHETYPES.map((a) => {
    let score = 0;
    if (a.matches.types.includes(property.type)) score += 2;
    if (a.matches.eras.includes(property.era)) score += 1;
    return { a, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((s) => s.a);
}

export function getArchetype(id: string): HouseArchetype | undefined {
  return ARCHETYPES.find((a) => a.id === id);
}

export function getPermutation(
  archetypeId: string,
  permutationId: string,
): InstallPermutation | undefined {
  return getArchetype(archetypeId)?.permutations.find((p) => p.id === permutationId);
}

/**
 * Materialise a stock-floor-plan room as a survey room (deterministic ids,
 * the same preset always produces the same room). Glazing/orientation start
 * at safe defaults the customer can tweak.
 */
export function buildPresetRoom(
  archetypeId: string,
  preset: RoomPreset,
  index: number,
): SurveyRoom {
  return {
    id: `${archetypeId}-preset-${index}`,
    name: preset.name,
    type: preset.type,
    size: preset.size,
    floor: preset.floor,
    glazing: "medium",
    orientation: "unsure",
    hasExternalWall: true,
    photos: [],
  };
}
