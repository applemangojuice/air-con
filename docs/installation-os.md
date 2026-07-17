# The engineering core: design rules, equipment selection, Installation OS

Three layers turn the platform from a quote generator into an engineering
assistant. Everything is one of three lights:

- Green: auto-approved. No human touches it.
- Amber: needs review. An engineer glances at one specific thing.
- Red: cannot determine. Data is missing and the rule says exactly what unlocks it.

All three layers are pure domain code (`packages/domain/src/design.ts` and
`install.ts`), covered by `node --test`, and run identically on the server
and in the browser demos.

## Layer 1: Design Rules Engine (`design.ts`)

Before any kit is chosen, every property is evaluated against a standard
rule set:

1. System topology: one multi-split, or does pipe length / port count force a split?
2. Pipe length and height limits against the outdoor unit's allowances.
3. Electrical spare capacity from the fuse board evidence.
4. Planning and conservation constraints from the property intelligence record.
5. Condensate drainage: gravity per room, or pumps specified automatically.
6. Indoor unit mounting: external walls as intended, or concealed routing flagged.
7. Maintenance clearances for the outdoor position.
8. Noise at the nearest neighbouring window, modelled from sound power,
   distance by built form, and screening for ground positions (42 dB(A)
   guidance).

The worst light wins: any red makes the design "cannot determine", any
amber "needs review", otherwise "auto-approved".

## Layer 2: Equipment Selection Engine (`design.ts`)

Once the rules have run, selection is deterministic. `designSystem(input)`
is the one button. From the survey, the property record, occupants and
preferences it returns:

- Outdoor condenser (sized with a 0.8 diversity factor, port-checked)
- Indoor unit model and capacity per room (heat-load based)
- Pipe diameters per room (liquid/gas pairs by capacity)
- Supply cable size, RCBO rating, rotary isolator
- Condensate pumps where gravity fails
- Trunking, wall plates, brackets, anti-vibration mounts, sleeves
- Refrigerant: pre-charge coverage plus additional charge in grams
- A full bill of materials the procurement module can order against

Catalogue numbers are typical R32 wall-split figures; swap in the chosen
manufacturer's datasheet values before real installs.

## Layer 3: Installation OS (`install.ts`)

Airline-checklist installs, built around required evidence instead of
ticks. Eleven phases (arrival, marking out, core drilling, indoor units,
outdoor unit, pipework, electrical, pressure test, vacuum, commissioning,
handover) expand into a concrete runsheet per job: per-room steps repeat
per room, per-system steps per outdoor unit.

Every step demands evidence before the job can move on:

- Photos and videos (protection, penetrations, gauges, walkthrough)
- Readings with accepted windows (torque N·m, vacuum microns, nitrogen bar,
  temperature split, earth continuity, clip spacing, noise)
- QR/barcode scans (serials for warranty, cable and RCBO verification)
- GPS fix on arrival, timestamps on every record, customer signature

The evidence log is append-only; a re-capture supersedes but never erases.
`scoreInstallation` decides completeness automatically:

- All slots in range: the job auto-approves. Nobody reviews it.
- Any reading outside its window: an exception, and only exceptions reach
  a human.
- Gates for pressure test, vacuum, commissioning, walkthrough and warranty
  feed the QC dashboard.

## Where to see it

- `/ops/design`: pick a property, press Design System, read the lights.
- `/ops/install`: the QC dashboard with the review queue and per-job scores.
- `/ops/install/[id]`: the engineer runsheet, playable end to end. Type a
  vacuum reading of 1200 microns to watch the exception flow work.

Real jobs will generate their runsheet from the design blueprint when kit
ships, and the mobile capture app wraps the same reducer with a camera and
barcode scanner.
