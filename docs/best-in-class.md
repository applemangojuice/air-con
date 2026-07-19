# Best-in-class benchmark: UK fixed-price D2C home air conditioning

What the leaders do (BOXT, Heatable, iHeat, Octopus heat pumps, US instant-quote
HVAC), what to copy, and the content moat to build. Researched 2026-07-19;
sources at the bottom. The build-state column tracks what this platform has.

## 1. Website patterns worth copying

| # | Pattern | Why | Our state |
|---|---------|-----|-----------|
| 1 | Hero = outcome + price + speed ("from £X,XXX installed · fixed price in 2 minutes") | Price is the #1 unknown; anchoring kills the "this'll be £10k" fear | ✅ hero price anchor (engine-computed) |
| 2 | Monthly-price framing beside cash price | Reframes £2k+ as subscription-sized | ✅ finance options on quote result; homepage shows monthly-from |
| 3 | Review count above the fold ("Excellent · 45,000+ reviews") | Unknown brand + £2k online = borrowed trust | ⏳ needs real Trustpilot reviews first — never fake |
| 4 | One question per screen, picture answers, no personal details until price | Contact-before-price is the single biggest funnel-killer | ◐ email now optional at step 1 (price without contact possible); required only to save |
| 5 | Reassurance microcopy at every step ("won't affect your price", "no calls") | Every question is a drop-off point | ✅ throughout funnel |
| 6 | Good-Better-Best tiered result | Converts yes/no into which-one; lifts AOV | ❌ needs product decision (single fixed price is also a brand position) |
| 7 | Save-my-quote + follow-up sequence | AC is considered over days | ✅ permanent /q links, draft recovery cron |
| 8 | Credentials as badges (F-Gas, manufacturer accreditation, warranty) | Badges are scanned, not read; F-Gas is a differentiator to explain | ◐ promises row; add badge strip when accreditations land |
| 9 | Date-picker checkout with real availability | Converts intent to commitment | ◐ booking with preferred-start; real calendar when crews exist |
| 10 | Flagship "air conditioning cost UK" page | SERP has no dominant D2C brand yet — open moat | ✅ /guides/air-conditioning-cost-uk, engine-computed prices + FAQ schema |

## 2. Operations patterns (ServiceTitan / Jobber / Commusoft distilled)

The loop: lead → quote → follow-up → booked → dispatch → done → paid → review.
Nothing sits in a stage without an owner and a next-action date.

| # | Pattern | Our state |
|---|---------|-----------|
| 1 | Every lead has status + next-action date, always; exception list for leads without one | ✅ next-action on quote detail; Due-today list on /ops |
| 2 | Automated follow-up cadence (T+1/T+3/T+7), auto-expiring quotes | ◐ one T+1 nudge (deliberately polite); quotes valid 60 days per terms |
| 3 | A "Today" view worked top-to-bottom every morning | ✅ /ops pulse + Due today + daily digest email |
| 4 | Quote→job conversion as a headline number, by source | ✅ /ops/review + per-quote utm_source |
| 5 | Invoice on completion, deposit at booking | ❌ needs Stripe (owner decision) |
| 6 | Capacity utilisation: installer-days booked vs available | ◐ /ops/schedule board; utilisation % when crews are real |
| 7 | Weekly plan-vs-actual, one page, one action per variance | ✅ /ops/review with the 15-minute agenda |
| 8 | Job costing per install: actual vs quoted margin | ◐ property_assessments ready for install actuals (knowledge loop) |

## 3. Content checklist (build order)

Launch-critical: **cost guide** ✅ · running costs (in cost guide) ✅ · how-it-works ✅ · guarantees (in terms + FAQ) ◐ · reviews page (needs real reviews) ⏳

SEO moat, next: planning-permission guide · noise guide · split-vs-portable comparison · AC-as-heating page · case studies (after first installs — photos, price paid, duration) · about/team with faces and F-Gas explainer.

Area pages: ✅ SW16/SW17 — add one only when a real local case study exists (thin-content risk).

## 4. The one strategic tension to decide

Heatable's "no personal details until the price" is the proven conversion
pattern; our save-early email capture powers the whole recovery machine
(draft rescue, follow-up cron, lost-lead alerts). Current compromise: email
is **optional** at step 1 (skippers still get a price; givers get saving +
recovery). Watch /ops/analytics funnel: if step-1 drop-off stays high,
consider moving contact fully to post-price like Heatable.

Sources: boxt.co.uk/air-conditioning · trustpilot.com/review/boxt.co.uk ·
heatable.co.uk (+ /new-boilers/quote) · iheat.co.uk · octopus.energy heat
pumps + Cosy · hvacquotes.com · myhvacprice.com · servicefirsthvac.com ·
goodguys.app · Checkatrade/MyJobQuote/British Gas AC cost guides.
