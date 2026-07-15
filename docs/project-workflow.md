# The project workflow

Everything after the instant quote runs on one horizontal timeline:

```
quote → floor plan → final quote → site visit → delivery → installation
```

The customer sees it at `/p/<id>` (playable demo at `/p/demo`), ops runs it at
`/ops/projects`. The whole machine lives in `packages/domain/src/project.ts`
next to the pricing engine, and follows the same rules: pure, deterministic,
JSON-serialisable, versionable.

## The timeline

- **Every stage is clickable, including the future.** Greyed/dotted stages open
  a *preview*: "what happens here" plus the real controls in a locked state,
  so the customer can see the whole journey on day one.
- **Every stage carries a date.** Actuals for what happened, **confirmed** for
  what's booked, *est.* projections for everything ahead
  (`projectTimeline(project, today)` computes them; nothing is hand-set).
- **Dates are booked by clicking the timeline.** Site-visit slots, the
  installation day and the delivery day are all set (and moved) by the
  customer from the stage panels.
- The compact strip version (`TimelineStrip`) appears in the quote funnel the
  moment the postcode step is done. Quote, dot dot dot.

## Stage rules (encoded in the reducer, not in UI)

| Stage | Completes when | Gate |
| --- | --- | --- |
| Quote | at creation | none |
| Floor plan | customer approves | ready instantly (stock archetype layouts, no designer wait) |
| Final quote | customer accepts | auto-issued at the same price when survey confidence is `high`; otherwise ops issues after photo review |
| Site visit | ops records outcome | **hard prerequisite for installation**, booking requires an accepted final quote |
| Delivery | courier delivers | auto-scheduled 2 days before installation when the install is booked |
| Installation | ops marks complete | requires site-visit approval **and** delivered equipment |

Every transition goes through `applyProjectAction(project, action, now)`, a
pure reducer. The API route runs it server-side as the authority; `/p/demo`
runs the identical reducer in the browser, which is why the demo is fully
playable with no database.

## The site visit (£150, 60 minutes)

One visit per project, run by the founder, video call by default (in person
where access needs real eyes). It exists to:

1. validate the floor plan room by room,
2. confirm the outdoor unit position and clearances,
3. **pin down the electrical connection** (see below),
4. review the survey videos together, and
5. answer everything before the customer commits to a date.

The fee is credited in full against the installation price. Payment is
currently recorded on confirmation and invoiced (`pay-site-visit` action).
Swap in a Stripe Payment Link / Checkout session at that action when payments
land.

## Date-change fees (escalating as the date approaches)

Defined in `RESCHEDULE_FEES` and computed by `rescheduleFeeGbp(kind, daysNotice)`.
The fee is always shown to the customer *before* they confirm a move.

| Notice | Site visit | Delivery | Installation |
| --- | --- | --- | --- |
| 14+ days | free | free | free |
| 7–13 days | free | £25 | £75 |
| 3–6 days | free | £60 | £150 |
| 1–2 days | £25 | £120 | £300 |
| same-day | £50 | £120 | £300 |

Fees accrue on the project (`projectFees`) and are added to the final balance.
No card needed at the moment of change.

## Our SLA to the customer (`SLA_COMMITMENTS`)

Remedies are automatic, the customer never has to argue for them:

- Final quote within 1 working day of floor-plan approval, or **£50 off**.
- Site visit starts within 15 minutes of the slot, or **the £150 is refunded
  (and still credited)**.
- Equipment arrives on the confirmed date, or **£50 off + £25/day**.
- Installation starts on the confirmed date, or **5% off**.
- Handover within the quoted install days, or **£100 off**.

Enforcement today is manual (ops applies the remedy); the event log carries
the timestamps needed to automate it later.

## Electrics: de-black-boxing the power connection

The survey's fuse-board answer seeds an assessment
(`provisional` / `attention`) with customer-facing copy, shown as the
"⚡ Your power connection" card on the site-visit and installation panels.
The site visit is the designated resolution point: ops records the agreed
plan (route, board work, isolation) and flips the status to `validated`.
Installation day copy warns about the ~30-minute power-off window. When a
real electrician network exists, `attention` outcomes become a work order.

## Equipment delivery

Kit is pre-shipped by courier, not van-carried. Booking the installation
auto-schedules delivery for `install − 2 days` (customer-adjustable within
courier lead time, must land before installation). Ops marks dispatch with a
courier + tracking ref; tracking events append to the project and render as a
feed. The courier API integration point is `ops-mark-dispatched` /
`ops-mark-delivered`, a webhook receiver can drive those same actions.

## Ops module (`/ops/projects`)

List + detail behind the same basic-auth wall as `/ops/quotes` (middleware
covers both). The detail page renders exactly the forms that are legal for
the current state: issue final quote, record site-visit outcome (+ electrics
plan), dispatch/deliver, assign the installer profile (shown to the customer
ahead of the day), complete installation. All of it dispatches the same
domain reducer via server actions.

## Persistence

`projects` table (migration `0005_projects.sql`): one row per quote
(unique `quote_id`, idempotent create), full `Project` JSONB snapshot as
truth, denormalised columns for list views recomputed on every save. History
is the embedded `events` array, also rendered to the customer as the
"Updates" feed.

## Deliberately not built yet

- **Auth.** Quotes and projects live on unguessable UUID links (like the
  saved quotes). When accounts land: Supabase Auth with **passkeys/OTP**
  (no passwords, email optional), RLS policies keyed on `auth.uid()`, one
  identity with `customer` / `admin` / `installer` roles. The ops basic-auth
  wall and UUID links are explicitly interim.
- **Payments.** Site-visit fee and change fees are recorded, not charged.
  Stripe attaches at two reducer actions (`pay-site-visit`, reschedules).
- **Courier API.** DPD/Parcelforce webhooks → `ops-mark-dispatched` /
  `ops-mark-delivered` + tracking-event appends.
- **iOS apps.** The capture app already shares `@aircon/domain`; the project
  timeline is the next shared surface (the `Project` snapshot + reducer are
  the same JSON on native).
- **SLA automation.** Event timestamps make missed-commitment detection a
  query; remedies are applied manually until then.
