# The Survey Capture Process

This document designs the **information capture process** behind the fixed-price
quote — what we collect, in what order, with what guidance, and how each item
feeds pricing, confidence and (later) automated design. The web funnel
(`apps/web/quote`) and the iOS capture app (`apps/mobile`) are two front-ends
for **the same process and the same data model** (`@aircon/domain` → `Survey`).

## Why the process is shaped like this

The whole business model rests on one substitution: **structured customer
capture replaces the surveyor visit.** Every question and photo exists to
answer something an engineer would otherwise discover on the doorstep:

| Surveyor would check | We capture instead | Feeds |
| --- | --- | --- |
| Which rooms, how big, how sunny | Room list: size band, glazing, orientation, floor | Heat load → unit sizing |
| Where units can mount | Room photo incl. target wall; external wall y/n | Design + internal-routing price adder |
| Where the condenser goes, access | Outdoor location choice + photo of spot & route | Mounting adders, review flags |
| Electrical capacity | Fuse-board type + photo | Electrics price line |
| Pipe run lengths | Floor level per room + property type/era | Complexity adders |
| "Can we actually do this?" | Everything above | Installation Confidence Score |

Ordering principle: **commitment ramps with investment.** Postcode first
(2 seconds, instant positive feedback), identity last (only after the customer
has done the work and wants the number). Photos are attached *in context* —
you photograph the bedroom while answering questions about the bedroom, not in
a photo-dump step at the end.

## The stages

1. **Address** — postcode (validated live against postcodes.io; district
   stored) + first line. Feedback: "we cover {district}".
2. **Property** — type, era, bedrooms, ownership. Era proxies wall
   construction; renting triggers landlord-consent messaging.
3. **Rooms** (repeatable) — per room: type, size band, floor, glazing,
   orientation, external wall, photo(s) of the wall the unit would mount on.
   Size *bands* not metres: customers guess bands reliably, and v2 measures
   properly (below).
4. **Outdoor unit** — location choice + photo of the spot and the access
   route to it.
5. **Electrics** — fuse-board type (with "not sure" — the photo is enough)
   + photo, door open.
6. **Contact** — name, email, phone (optional), timeframe.
7. **Result** — fixed price, system design, confidence score with explicit
   gaps ("add a fuse board photo to lock this in"), finance, booking.

Draft state survives interruption on both platforms (localStorage / device
storage) — people survey a home in bursts.

### Photo spec (per subject)

- **Room**: stand in the doorway, whole target wall in frame, ceiling line
  visible. One photo minimum; window wall as a second if glazing is "lots".
- **Outdoor spot**: 3–4 m back, ground/wall where the unit sits plus the
  route an engineer walks to reach it.
- **Fuse board**: straight on, door open, close enough to read breaker labels.
- Guidance is shown as short overlay prompts at capture time (iOS) or
  captions (web). Reject-and-retake prompts (blur/darkness detection) are a
  v1.5 addition; nothing blocks submission — missing/poor photos lower the
  confidence score instead.

## Confidence is the contract

The Installation Confidence Score (in `@aircon/domain/confidence.ts`) is the
honest broker between "instant price" and "no surprises":

- **≥ 80 (high)** — price guaranteed as-is.
- **60–79 (medium)** — price fixed after a same-day photo review.
- **< 60 (low)** — close estimate; the UI lists exactly what to add.

This lets us quote *everyone instantly* without eating the risk of blind
fixed pricing, and it gives the customer agency: more evidence → firmer price.

## Why a native iOS capture app at all

The web funnel is the acquisition surface — zero-install, link-from-an-ad.
The iOS app is the **capture instrument**, for the cases where the phone's
sensors do the surveying:

- **v1 (this scaffold)**: same flow as web, but with native camera UX,
  offline-first drafts, multi-shot capture in one gesture. Used by early
  customers with patience for an install, and by *our own people* doing
  assisted surveys door-to-door (street campaigns).
- **v1.5**: guided capture — per-shot overlay prompts ("show the ceiling",
  "step back"), on-device blur/exposure checks, auto-tagging.
- **v2**: **measured rooms** — ARKit/RoomPlan scans replace size bands with
  real dimensions, generate the floor plan, and feed exact wall lengths and
  glazing areas to the heat-load model. This is where quote accuracy stops
  depending on customer guesses. (RoomPlan requires LiDAR devices; the
  photo flow remains the fallback.)
- **v3**: the scan + photos feed automated unit placement and pipe routing —
  the AI design step in the roadmap.

**Stack**: Expo / React Native + TypeScript, sharing `@aircon/domain`
verbatim (the engine runs on-device for instant pricing, same as the web).
RoomPlan lands later as a native module inside the same app — going
Swift-first today would fork the domain logic for a sensor we don't use yet.
The app talks to the same `apps/web` API routes (`/api/uploads`,
`/api/quotes`); there is deliberately no separate mobile backend.

## Data contract

Both clients produce one artifact: a `Survey` JSON (see
`packages/domain/types.ts`) plus photo files. Photos upload to the private
`survey-photos` bucket via signed URLs; the survey (with storage paths) posts
to `/api/quotes`, where the server recomputes the price and stores
`{engine_version, survey, quote}`. Capture source is distinguishable by the
`source` field ("web" | "ios") so we can compare conversion and survey
quality per instrument.
