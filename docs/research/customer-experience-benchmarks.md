# Customer and installer experience benchmarks

Researched on 18 October 2026 for Dang, It's Hot: a South London installer of R32 split and multi-split systems, with four pilot installs coming up.

This document covers what happens at each stage of a home energy install, from booking the survey to the annual service, plus what installers' field apps do. It ends with 15 things to do and 10 things to avoid. Companion documents:

- [`docs/best-in-class.md`](../best-in-class.md): website and funnel benchmarks, July 2026.
- [`commissioning-standards.md`](commissioning-standards.md): technical records.
- [`services-and-costs.md`](services-and-costs.md): the monthly budget for third-party services.

## Read this first: what this research could and could not reach

This pass ran with **no live access to any benchmark company's website**:

- **Web search.** The workflow's shared search budget (200 calls) was used up before this task started. All four searches returned "budget used up".
- **WebFetch.** Every host failed DNS (`getaddrinfo ENOTFOUND`). Hosts tried: octopus.energy, www.airahome.com, getjobber.com, help.getjobber.com, www.servicetitan.com, www.boxt.co.uk, www.heatgeek.com, en.wikipedia.org, www.daikin.co.uk, www.legislation.gov.uk and mcscertified.com.
- **Shell egress.** The proxy refused octopus.energy and getjobber.com (`connect_rejected`). Only raw GitHub content was reachable.
- **Earlier results.** None of the cached search results from other agents in this workflow mention any of the ten benchmark companies.

So **no page from Octopus, Aira, BOXT, Heat Geek, British Gas, Jobber, ServiceTitan, Tesla, Sunrun or Hometree was read in this session.** Everything attributed to those companies below is my recall. It is graded **U** and used only to describe *patterns*. **None of their figures are given:**

- install durations
- warranty or guarantee lengths
- review counts or ratings
- prices
- response times
- message timings

All of these are `null`. §8 lists what to check.

These sources *are* verified:

- **UK legislation.** The legal research agent cached the legislation.gov.uk text earlier today, and I read the wording directly from that copy.
- **GOV.UK Design System patterns.** Fetched directly from the Design System's GitHub source.
- **Earlier research in this repo.** It carries its own sources.

The patterns are still worth copying on their merits. What is unverified is *who* does them and *how exactly*.

| Grade | Meaning |
|---|---|
| **O** | UK legislation. Read from the legislation.gov.uk text cached in this workflow (each file's frontmatter names its legislation.gov.uk `source` and a last-updated date), not opened live. The wording is reliable. **My reading of it is not legal advice.** |
| **D** | Official design guidance read directly this session: the GOV.UK Design System source, pinned to commit `a1bfd60d`. |
| **R** | Earlier research in this repo. It carries its own source and grade; I give that grade where it matters. |
| **U** | Unverified. My recall of how a benchmark company works, or general trade practice. No numbers. |

---

## 1. The journey at a glance

| # | Stage | Pattern to copy | Benchmarks I recall doing it (U) | Hard rule behind it | Where it lives in our code |
|---|---|---|---|---|---|
| 1 | Before the survey | Customer sends photos and video first. The visitor is introduced by name and photo. | Tesla (photos for remote design); ServiceTitan (technician intro) | – | `survey-booked`, `survey-reminder`; video surveys (`0004_video_surveys.sql`) |
| 2 | Survey visit | Fixed checklist. Written report of findings **and promises**. No signing on the spot. | Heat Geek (design-led survey); Octopus (survey before the final quote) | CRA 2015 s.50 (O); CCR 2013 regs 5, 10 and 19 (O) | `surveyor-on-my-way`, `survey-complete`; document `survey-report` |
| 3 | Proposal | Online and versioned. Photos of the real positions, itemised kit, Schedule 2 content. A check-answers step before acceptance. | Tesla (design shown in the app); Jobber (quote approval in Client Hub); ServiceTitan (good/better/best options) | CCR Sch 2 and reg 40 (O); DMCC Sch 20 para 7 (O); GOV.UK check answers (D) | `proposal-issued`, `proposal-reminder`; document `proposal` |
| 4 | Acceptance and cooling-off | Confirmation and cancellation form at once. Early start only on an express request. | Not benchmarked | CCR regs 12, 30, 31 and 36 (O) | `proposal-accepted`; document `contract` |
| 5 | Waiting for the install | One tracker page with few statuses. Customer prep tasks. Kit news only when it's real. | Tesla, Sunrun (project milestones in the app); Jobber (upcoming visits) | GOV.UK "complete multiple tasks" (D) | `install-booked`, `kit-update`, `install-prep` |
| 6 | Install days | Evening before, on my way with an ETA, end-of-day photo update. Variations approved in writing. | British Gas, Jobber (reminders); Jobber, ServiceTitan, British Gas (on-my-way or tracking) | SMS length rules (R); CRA s.50(2)(b) and (4) (O) | `install-day-before`, `installer-on-my-way`, `install-day-update`, `variation-approval`, `issue-update` |
| 7 | Handover | Walk-through on site plus a digital pack the same day. Certificates that come later shown as pending, with a due date. | Heat Geek ("how to run it"); Octopus and Aira (app-based ownership) | Building Regs 2010 regs 20(3), 40 and 44 (O); CRA s.15 (O) | `handover-ready`; documents `commissioning-certificate`, `handover-pack` |
| 8 | Aftercare | 7-day and 30-day check-ins, a first change-of-season check, annual service, a "report a problem" link in every message. | British Gas, Hometree, BOXT (care plans); Aira, Octopus (monitoring in the app) | CRA s.49 (O) | `check-in-7d`, `feedback-30d`, `service-reminder`, `issue-update` |
| 9 | Reviews | Ask **every** customer in the same way, on an independent platform, with no undisclosed incentive. Publish every review. | Octopus, BOXT (large Trustpilot presence; counts `null`) | DMCC Sch 20 para 13 (O); PECR reg 22 (O) | `feedback-30d`, which needs a change (see A1) |

---

## 2. Customer journey patterns, stage by stage

### 2.1 Before the survey

- **P1. Pre-survey evidence pack (U).** My recollection is that Tesla asks solar customers to upload photos of their electrical panel during onboarding, so the design can start remotely. UK digital-first heat pump sellers also qualify homes online before anyone visits.
  - **Copy:** ask for a short phone video walk-through and named photos:
    - consumer unit (fuse board)
    - each proposed indoor wall
    - the proposed outdoor position
    - the route between indoor and outdoor
    - parking and access
  - The repo already has video surveys (`supabase/migrations/0004_video_surveys.sql`).
  - The visit then *confirms* the design instead of *discovering* it.
- **P2. A named visitor with a face (U).** ServiceTitan is known for a pre-arrival message carrying the technician's name, photo and a short bio.
  - **Copy:** `survey-reminder` and `install-day-before` should name and picture who is coming.
  - The registry already says `survey-reminder` covers "time, who's coming, fuse board and loft access" (`packages/domain/src/comms.ts`).
- **P3. Every booking ends with "what happens next" (D).** GOV.UK says a confirmation page must include:
  - "a reference number, if there is one"
  - "details of what happens next and when"
  - "contact details for the service"
  - links to what users need next
  - "a way for users to save a record of the transaction, for example, as a PDF"

  It also notes that "some users will bookmark the confirmation page as a form of receipt". Apply this to the survey booking, proposal acceptance, install booking and handover pages.

### 2.2 The survey visit

- **P4. Fixed survey checklist (U, trade practice).**
  - Size each room.
  - Agree the indoor and outdoor positions *with the customer*.
  - Trace the pipe and condensate routes.
  - Check the electrical supply and consumer unit.
  - Check the outdoor position against permitted development and the MCS 020 noise check. See [`commissioning-standards.md` §9](commissioning-standards.md) (R).
  - Check access and parking.
  - Photograph each item.

  Heat Geek's network is known for design-led, room-by-room surveys, and Octopus surveys before giving the final quote (both U).
- **P5. A written survey report that records promises (O).** Under the Consumer Rights Act 2015 s.50(1), "anything that is said or written to the consumer, by or on behalf of the trader, about the trader or the service" becomes a term of the contract if the consumer takes it into account when deciding.
  - So anything the surveyor says out loud binds the business: "you won't hear it at night", "it'll be done in two days", "it'll cut your bills".
  - Write such statements down, and qualify them **on the same occasion**: s.50(2)(a).
  - Put them in the `survey-report` document.
- **P6. No signing in the home (O).** Under CCR 2013 reg 5, a contract concluded in the customer's home while trader and consumer are both present is an **off-premises contract**. So is one where the consumer makes the offer there, or one concluded by distance means "immediately after the consumer was personally and individually addressed" there.
  - **What it triggers:** before the consumer is bound, the trader must give the Schedule 2 information and the Schedule 3 cancellation form, "on paper or, if the consumer agrees, on another durable medium" (reg 10(1)–(2)).
  - **The penalty:** failing to give the right-to-cancel information is a **criminal offence** (reg 19), with a fine up to level 5 on the standard scale.
  - "Sign on my tablet before I go" falls in this category. So does "accept the link while I'm still here".
  - A proposal sent later and accepted online is more likely a distance contract. Regs 13 and 16 then apply; I read only their headings this session.
- **P7. `survey-complete` gives a date, not "soon".** The registry text already says "when to expect the proposal".

### 2.3 The design and the proposal

- **P8. A proposal you can see (U for the benchmarks).** Tesla shows a panel-layout design in the customer's app or account. Jobber's Client Hub lets clients approve quotes online. ServiceTitan technicians present tiered options on a tablet.
  - **Copy:** a web page plus PDF showing:
    - a photo of each agreed indoor and outdoor position, with the unit marked
    - the pipe and condensate routes
    - the kit by model number
    - the noise-check result
    - what's included and excluded
    - the total including VAT
    - the payment schedule
    - when we'll do the work
    - guarantees
    - complaints
  - `packages/domain/src/documents.ts` already freezes each issued document as a versioned snapshot (e.g. `DIH-PR-7F3A-v2`). That is the right base.
- **P9. Schedule 2 as the proposal's content checklist (O).** CCR Schedule 2 lists what must be given before a distance or off-premises contract. The items that matter here:

  | Sch 2 | Requirement (paraphrased; the wording is in the regulations) | Proposal section |
  |---|---|---|
  | (a) | Main characteristics of the goods or services | Design, kit list, photos |
  | (b), (c), (e) | Trader identity, geographical address, phone and email; complaints address if different | Header and footer |
  | (f) | Total price inclusive of taxes | Price box |
  | (g) | Additional charges, or the fact that they may be payable | "What could change the price" |
  | (j) | Arrangements for payment and performance, and "the time by which the trader undertakes … to perform the services" | Payment schedule; install window |
  | (k) | Complaint handling policy | Link |
  | (l) | Conditions, time limit and procedure for cancelling | Cancellation section plus model form |
  | (n) | That the consumer pays reasonable costs if they cancel after asking for an early start | Early-start box |
  | (o) | Where the right to cancel may be lost, and how | Early-start box |
  | (q) | After-sales service and commercial guarantees, with their conditions | Guarantee section |
  | (r) | Relevant codes of conduct, and how to get them | Only if we sign up to one |
  | (u) | Deposits | Payment schedule |
  | (x) | Out-of-court complaint and redress mechanism, if we are subject to one | Complaints section |

  CRA s.50(3) makes this information a term of the contract. Under s.50(4), changing it needs express agreement.
- **P10. Acceptance through a check-answers step (D and O).** GOV.UK check answers pages "reduce error rates as users are given a second chance to notice and correct errors before submitting". Make it clear "the transaction will not be complete until a user confirms". Name the action on the button, for example "Accept proposal DIH-PR-…-v2", and give each section a "Change" link.
  - Optional extras must be **chosen**, never defaulted. Under CCR reg 40(2), consent "inferred from the consumer not changing a default option (such as a pre-ticked box on a website)" is not express consent, and an extra payment taken that way must be refunded (reg 40(4)).
- **P11. Real validity dates only (O).** DMCC Act 2024 Sch 20 para 7 bans "falsely stating that a product will only be available for a limited time … in order to elicit an immediate decision".
  - A `validUntil` tied to a real reason, such as a supplier price hold, is fine.
  - Para 28 bans "persistent and unwanted solicitations". The single `proposal-reminder` nudge is the right amount.
- **P12. One recommended design, not a menu (U, judgement).** ServiceTitan-style good/better/best is built for in-home selling. For a premium installer doing four pilots, offer one recommended design, plus at most one alternative with the trade-off explained. `best-in-class.md` lists tiered pricing as an open product decision.

### 2.4 Acceptance and the cooling-off period

- **P13. Confirmation on a durable medium, at once (O).**
  - For an off-premises contract, reg 12 requires a copy or confirmation of the contract on paper or another agreed durable medium "before performance begins of any service".
  - For distance contracts the equivalent is reg 16 (heading read only).
  - The architecture's `proposal-accepted` customer copy ("contract and cancellation form, the durable medium") matches this.
  - A "durable medium" includes email (reg 5).
- **P14. Early start only on an express request (O).**
  - Reg 36(1): the trader "must not begin the supply of a service before the end of the cancellation period" unless the consumer has made an express request. For an off-premises contract, the request must be on a durable medium.
  - If the customer then cancels, they pay a proportionate amount: reg 36(4).
  - They pay **nothing** if we failed to give the cancellation information, or if work began without a proper request: reg 36(6).
  - The cancellation period also runs **up to 12 months longer** if the cancellation information was never given: reg 31(3).
- **Legal check needed before the first pilot contract (O wording; my reading is not legal advice).**
  - CCR reg 5 defines a "sales contract" as including "any contract that has both goods and services as its object". A "service contract" is a contract "other than a sales contract".
  - For a sales contract, reg 30(3) ends the cancellation period "14 days after the day on which the goods come into the physical possession of" the consumer, not 14 days after the contract.
  - Supply-and-install of an air conditioning system looks like a goods-and-services contract.
  - `docs/pilot-architecture.md` sets `cancellationEndsOn = date(now) + settings.cancellationDays` at acceptance.
  - If my reading is right, the real period can end **later** than the app shows: 14 days after the kit reaches the home or is installed.
  - Regs 28(3)(c) (goods "mixed inseparably" with other items after delivery) and 34(9) (diminished value) may also matter.
  - Have a solicitor or Trading Standards check this. Trading Standards' Business Companion guidance was not reached this session.

### 2.5 Between acceptance and the install

- **P15. One tracker page the customer comes back to (D, with U benchmarks).** Tesla and Sunrun show project milestones in their apps, and Jobber's Client Hub shows upcoming visits (U). The GOV.UK "complete multiple tasks" pattern (D) says:
  - show the page "at the start of each returning session"
  - "group related actions into tasks"
  - "show the status of the tasks"
  - start with the fewest statuses ("Completed", "Incomplete", or "Not yet started" and "In progress")
  - use "Cannot start yet", unlinked, for blocked tasks

  An example for us:

  | Task | Status |
  |---|---|
  | Survey | Completed |
  | Proposal | Completed |
  | Cooling-off | In progress, ends DATE |
  | Kit | In progress |
  | Install | Not yet started |
  | Handover | Cannot start yet |
  | Building Regulations certificate | Cannot start yet |

  Customer tasks start with a verb: "Clear the wall below each indoor unit", "Arrange a visitor parking permit".
- **P16. Kit news only on real events.** The registry rule for `kit-update` is already right: "Never sent on an estimate."
- **P17. Explain the invisible waits (U).** Sunrun-style trackers make waits like permits and inspections visible. Ours are:
  - the cooling-off period
  - supplier lead time
  - the Building Regulations certificate after the install (see §2.7)

### 2.6 Install days

- **P18. `install-prep`, a few days before:** the prep checklist and the power-off warning. This already exists.
- **P19. `install-day-before`, the evening before:** arrival time, who is coming (name and photo), parking, how long the work will take, power-off times, what we need from the customer. British Gas and Jobber send automated visit reminders (U).
- **P20. `installer-on-my-way`, with an ETA, triggered by a tap in the field app rather than by the schedule.** Jobber's on-my-way text, ServiceTitan's technician tracking and British Gas engineer tracking all do this (U).
  - SMS rules (R; source: GOV.UK Notify's pricing page, via [`services-and-costs.md`](services-and-costs.md) [N1]):
    - up to 160 GSM characters is 1 message, up to 306 is 2
    - **any non-GSM character (an emoji, a curly apostrophe) drops a single message to 70 characters**
    - an alphanumeric sender is one-way, so always include a phone number
- **P21. `install-day-update`, the end-of-day report, every day:**
  - what's done
  - a few photos the installer picks
  - what's tomorrow
  - anything the customer must decide
  - the state of tidying up

  I can't confirm that any benchmark does this as standard (U). On four pilots it is cheap, and the clearest way to show premium service.
- **P22. Variations: written, priced, approved before the work (O).** Under CRA s.50(2)(b) and (4), a change to what was agreed needs the consumer's express agreement. `variation-approval` puts the yes or no in the portal. Never do "while we're here" work on a verbal OK.
- **P23. Problems reported the same day.** `issue-update` already covers "what we found, what happens next, when".

### 2.7 Handover

- **P24. Two parts: walk-through, then the pack (U pattern; O and R contents).**
  - **On site**, show the customer:
    - modes and the remote
    - app pairing
    - how to clean the filters
    - where the condensate goes
    - what normal sounds and defrost steam look like
    - where the isolator is
  - **The same day**, publish the online pack (`handover-ready`). Heat Geek installers are known for leaving owners a plain "how to run it" explanation, and Octopus and Aira put ownership in an app (all U).

  **Handover pack contents**

  | # | Item | Why | Grade and source |
  |---|---|---|---|
  | 1 | Commissioning certificate, with readings per indoor unit | Evidence of a correct install. Under CRA s.15, goods installed incorrectly by the trader do not conform to the contract. | R ([`commissioning-standards.md`](commissioning-standards.md) §4); O (CRA s.15) |
  | 2 | F-gas record: factory charge, additional charge, total kg and tCO2e, plus a photo of the completed label in the outdoor unit | Required by the label; needed for the warranty | R/M (Daikin installer guide, via `commissioning-standards.md` §5) |
  | 3 | BS 7671 Electrical Installation Certificate, with the schedule of test results | New circuit; Part P | R/S (`commissioning-standards.md` §7) |
  | 4 | **Building Regulations compliance certificate**, shown as "pending, due by DATE" until it arrives | Building Regs 2010 reg 20(3): under self-certification, the person carrying out the work must, "not more than 30 days after the completion of the work", give the occupier a copy of the certificate and notify building control. Schedule 3 lists "installation of an air conditioning or ventilation system in a dwelling, that does not involve work on a system shared with other dwellings" as self-certifiable by someone registered with Blue Flame Certification, BESCA, Certsure LLP or NAPIT. (The cached text ends that list with an ellipsis.) | O ([reg 20](https://www.legislation.gov.uk/uksi/2010/2214/regulation/20), [Sch 3](https://www.legislation.gov.uk/uksi/2010/2214/schedule/3)) |
  | 5 | Information about the system and its **maintenance requirements**, enough to run it efficiently | Reg 40(2): where Part L1 imposes a requirement, the person carrying out the work must provide this to the owner "not later than five days after the work has been completed". Whether L1 applies to a given AC install: ask the scheme operator. | O ([reg 40](https://www.legislation.gov.uk/uksi/2010/2214/regulation/40)) |
  | 6 | (Internal) commissioning notice to building control | Reg 44: where it applies, notice "not more than 30 days after completion". Track it; it isn't a customer document. | O ([reg 44](https://www.legislation.gov.uk/uksi/2010/2214/regulation/44)) |
  | 7 | Manufacturer warranty registered **for** the customer, with the confirmation | Daikin: within 90 days of commissioning (S). Mitsubishi: `null`. Panasonic: register on PRO Club, time limit `null`. | R ([`commissioning-standards.md`](commissioning-standards.md) handover records) |
  | 8 | Our workmanship guarantee, its conditions and how to claim | Commercial guarantees and their conditions must also be in the pre-contract information (CCR Sch 2(q)) | O |
  | 9 | Manufacturer user manual, plus our one-page "how to run it" card | Plain English: suggested modes, "set it and leave it", filter cleaning (interval per manual, `null` here), what's normal | U pattern |
  | 10 | As-built photos: units, pipe route, condensate route, isolator, outdoor fixings | Future service visits; disputes (CRA s.15) | U pattern; O (s.15) |
  | 11 | Service schedule, how to report a problem, contacts | Aftercare loop | U pattern |
  | 12 | A saveable PDF of the whole pack | GOV.UK: "a way for users to save a record … as a PDF" | D |

### 2.8 Aftercare

- **P25. A fixed cadence.**
  - `check-in-7d`, which exists.
  - `feedback-30d`, which exists but needs changing (A1).
  - **A first change-of-season check** (new; my proposal, not a benchmark): the first heating spell after a summer install, or the first hot spell after a winter install.
  - `service-reminder`, which exists.
  - Aira and Octopus monitor their own heat pumps through their apps (U). For splits, the manufacturer's Wi-Fi app could do something similar if the customer agrees. Not researched here.
- **P26. Aftercare as a product (U).** Hometree, British Gas and BOXT sell cover or care plans after the install. Don't sell a plan during the pilots. Learn what owners actually need first. No price is proposed here.
- **P27. A "report a problem" link in every message.** It feeds the existing `issue-update` loop. Under CRA s.49, the service must be performed "with reasonable care and skill", and fixing things quickly is how that shows.

### 2.9 Review requests

- **P28. Ask everyone, at the same point, in the same words (O and U).** DMCC Act 2024 Sch 20 para 13 (in force from 6 April 2025 under SI 2025/272) bans these practices outright:
  - submitting, or commissioning someone to submit, "a fake consumer review" or "a consumer review that conceals the fact it has been incentivised"
  - publishing reviews "in a misleading way". The Act's examples include:
    - "failing to publish, or removing from publication, negative consumer reviews whilst publishing positive ones"
    - "giving greater prominence to positive consumer reviews over negative ones"
  - publishing reviews without "reasonable and proportionate steps" to prevent and remove fake ones or ones with concealed incentives

  Para 13 does not mention *selective invitation* ("review gating") in so many words. My recollection is that the CMA's fake-reviews guidance and Google's and Trustpilot's business rules treat it as not allowed (U, not verified). **Treat it as prohibited.**
- **P29. No incentives.** Para 13(5)(g): "commissioning" includes "incentivising by any means". A discount, prize draw or gift for a review makes it an incentivised review, and that has to be made apparent. The simple rule: offer nothing.
- **P30. Opt-out lines and channels (O).**
  - PECR reg 22 allows direct-marketing email to customers without fresh consent (the "soft opt-in"), but only if all three hold:
    - the details were obtained "in the course of the sale or negotiations for the sale"
    - the marketing is for "similar products and services"
    - a simple way to refuse was given when the details were collected and is given "at the time of each subsequent communication"
  - PECR's "electronic mail" "includes messages sent using a short message service" (reg 2), so SMS counts too.
  - Whether the ICO treats a plain review request as marketing was not checked (U). Put an opt-out line in every message that isn't purely transactional.
- **P31. Timing (U).** Ask after the customer has lived with the system. The repo's 30-day point is sensible. Keep the internal 0–10 score, but **never make the review request depend on the score**.
- **P32. Our own website.** Show every review, or embed the platform's own feed. Don't display a review count until it is real; `best-in-class.md` already says "never fake".

---

## 3. Installer field app patterns

The benchmark column is recall (U). The "our pilot needs" column draws on verified repo research where it says so.

| Capability | What the benchmark apps do (U) | What our pilot needs | Hook |
|---|---|---|---|
| **Job pack** | ServiceTitan and Jobber show job details, customer notes, attachments and history on the phone | One screen per job day: address, access and parking notes, customer phone, the **accepted proposal version** (drawings and photos), kit list with serial-number capture, survey photos, known hazards | Accepted proposal snapshot (`documents.ts`) |
| **Checklists and forms** | ServiceTitan forms can be made required before a job closes; Jobber has job forms and checklists | Commissioning record per unit: tightness test, vacuum, flare torque, readings. The manufacturer figures are `null` in the repo until confirmed per model. Additional charge is computed from the **as-built** liquid-line length. | R ([`commissioning-standards.md`](commissioning-standards.md) app defaults) |
| **Photo evidence** | Both attach photos to the job; before and after photos are common | Required photo slots, each timestamped: F-gas label, outdoor fixings, pipe route, condensate route, isolator, consumer unit. The installer picks the end-of-day photos. | `install-day-update`; R (§5 label photo) |
| **Offline** | ServiceTitan's mobile app works offline; I recall Jobber's offline support is partial | Capture must work in basements, lofts and back gardens with no signal. Queue uploads; never lose a photo. Upload straight to Supabase Storage, because Vercel functions accept at most 4.5 MB per body. | R ([`services-and-costs.md`](services-and-costs.md) §2) |
| **Timesheets** | ServiceTitan records job-status timestamps (dispatched, working, done); Jobber has clock in/out with GPS | Status-based time per job stage (travel, first fix, second fix, commissioning, handover). For **pilot job costing**, not payroll. | Pilot learning loop (`/ops/review` in `best-in-class.md`) |
| **On my way** | One tap sends an ETA text (Jobber); tracking link (ServiceTitan, British Gas) | One tap sends `installer-on-my-way` with an ETA. A live map isn't needed for four pilots. | `installer-on-my-way` |
| **Variations on site** | Estimates and options priced from a pricebook on the device (ServiceTitan) | Raise a variation with photo and price; the customer approves it in the portal **before** the work starts | `variation-approval`; O (CRA s.50) |
| **Signatures** | Signatures captured on the device for estimates and job completion (both) | Handover acknowledgement only. No signing of sales contracts in the home (P6). | O (CCR reg 10, reg 19) |
| **Snags** | Notes and follow-up jobs | Snag with photo, owner and due date | `issue-update` |
| **Close-out gate** | Required forms block completion (ServiceTitan) | The job isn't "complete" until all of these are in: EIC PDF, scheme notification reference, F-gas record, warranty registration. Building Regs certificate is tracked to 30 days. | R (`commissioning-standards.md` §7 says to keep the job open until all three electrical items are in); O (reg 20(3)) |

---

## 4. Benchmark notes by company (all U: recall, nothing verified this session)

| Company | Market | What I recall they do well | Copy | Verify at |
|---|---|---|---|---|
| **Octopus Energy** (heat pumps) | UK | Online indicative price before a visit; own surveyors and installers; survey before the final quote; one account for the quote, the booking and later the energy data and tariff; heat pump controls in the Octopus app for its own unit | Price first; one account from quote to ownership | octopus.energy (heat pumps section) |
| **Aira** | UK | One brand for the heat pump hardware, the app, the install, finance and a long guarantee (length `null`); app control and remote monitoring | Aftercare built into the offer, not sold later | airahome.com/uk |
| **BOXT** | UK (boilers, heat pumps, air con) | Fixed price online and a choice of install date at checkout; large Trustpilot presence (count `null`); care plans | Price-to-date checkout; review volume from asking every customer | boxt.co.uk; trustpilot.com/review/boxt.co.uk |
| **Heat Geek** | UK (training body and installer network) | Design-led surveys (room by room); low-temperature design; installers publish real performance data, e.g. on heatpumpmonitor.org; plain "how to run it" handovers | Show the design working; teach the owner how to run it | heatgeek.com |
| **British Gas** | UK | Appointment reminders; "engineer on the way" with tracking; annual service under HomeCare plans | On-my-way with ETA; the annual service as the relationship | britishgas.co.uk |
| **Jobber** | Field-service software (North America; used in the UK) | Client Hub, where clients approve quotes, see visits, pay invoices and request work; automated quote and visit reminders; on-my-way texts; post-job follow-up and review requests; mobile forms, photos, time tracking, signatures | The portal-as-hub; automatic follow-ups | getjobber.com; help.getjobber.com |
| **ServiceTitan** | Field-service software (US, enterprise) | Pre-arrival technician profile (name, photo, bio) and tracking; offline mobile app; required forms; photos and video; tablet good/better/best proposals; payment on the spot; job-status timestamps | The technician intro; required forms; status timestamps as timesheets. **Don't copy** the in-home tablet close (P6, A4). | servicetitan.com |
| **Tesla** (solar) | US | Customer-uploaded photos for remote design; project milestones and scheduling in the Tesla app; the same app for production monitoring after the install | Customer evidence pack; one app from order to ownership | tesla.com/support (energy) |
| **Sunrun** | US | Project stages shown to the customer (site survey, design, permits, install, inspection, permission to operate), then monitoring | Make the waiting stages visible | sunrun.com |
| **Hometree** | UK (home cover; heat pumps) | Aftercare sold as a product: cover and servicing plans | An optional aftercare plan, decided after the pilots | hometree.co.uk |

---

## 5. Fifteen "do this" recommendations for a small premium installer running four pilots

Each one names the evidence and where it fits in the existing code.

1. **Introduce every visitor by name and photo before they arrive.** Put this in `survey-reminder` and `install-day-before`, and say what they'll do and for how long. (U pattern from ServiceTitan; low effort.)
2. **Get the customer's photos and video before the survey, and draft the design from them.** The visit then confirms instead of discovering, and the proposal goes out faster. (U pattern from Tesla; video surveys already exist.)
3. **Run every survey to the same checklist, and send a written survey report that lists every promise.** Make it a `survey-report` document. Anything said that the customer relies on is a contract term (O: CRA s.50(1)); qualify claims on the spot (s.50(2)(a)).
4. **Never take a signature or acceptance in the home.** Send the proposal afterwards. Signing in the home creates an off-premises contract, which needs paper information and a cancellation form before the customer is bound (O: CCR regs 5 and 10). Getting the cancellation part wrong is an offence (reg 19).
5. **Make the proposal a frozen, versioned page built from photos of the real positions, with every Schedule 2 item.** That covers price including VAT, timing, payment, cancellation, guarantees and complaints (O: CCR Sch 2, CRA s.50(3)). `documents.ts` snapshots already do the freezing.
6. **Accept through a check-answers step.** Show every section with a "Change" link and a button that names the action. Optional extras must be **unticked** by default (D: GOV.UK check answers; O: CCR reg 40(2)).
7. **Handle the cooling-off period openly.** Show the date it ends. Offer an early start only through an express request recorded on a durable medium (O: CCR reg 36(1)). Before the first contract, **have a lawyer check the date calculation**: goods plus install may be a "sales contract", and then the period runs from when the goods arrive (O: regs 5 and 30(3); §2.4).
8. **Give each customer one tracker page with few statuses.** Include "Cannot start yet" for blocked items such as the Building Regulations certificate, and customer tasks that start with a verb (D: GOV.UK "complete multiple tasks"; U pattern from Tesla and Sunrun).
9. **Keep a fixed rhythm on install days:**
   - prep a few days before
   - the evening before
   - on my way with an ETA, sent from a button in the field app
   - **an end-of-day photo update every day**

   Keep each SMS within 160 GSM characters and always include a phone number (R: [N1]; event IDs already exist).
10. **Price and approve every change in writing before doing it,** through `variation-approval` (O: CRA s.50(2)(b) and (4)).
11. **Hand over in two parts:** a walk-through on site, then the same-day pack in §2.7. Show items still to come with their legal due dates: the Building Regs certificate within 30 days (O: reg 20(3)) and maintenance information within 5 days (O: reg 40(2)).
12. **Register the manufacturer warranty for the customer at handover, and put the confirmation in the pack.** Daikin requires registration within 90 days of commissioning (R/S). Mitsubishi and Panasonic rules are still `null`.
13. **Follow a fixed aftercare rhythm:** 7 days, 30 days, the first change of season, and the annual service, with a "report a problem" link in every message. The change-of-season check is new: add a `seasonal-check` event. (U; CRA s.49.)
14. **Ask every customer for a review, at the same point and in the same words, on an independent platform, with no incentive.** Include an opt-out line, and publish every review you get (O: DMCC Sch 20 para 13, in force 6 April 2025; PECR reg 22). Keep this separate from the internal score (A1).
15. **Gate job close-out in the field app.** Before a job can close, require:
    - the photo slots
    - a commissioning record per unit
    - the EIC
    - the scheme notification reference
    - the F-gas record
    - warranty registration

    Capture must work offline, and job-status timestamps double as the timesheet for pilot job costing. (R: `commissioning-standards.md`; U pattern from ServiceTitan and Jobber.)

## 6. Ten "avoid this" anti-patterns

1. **Review gating, including the current `feedback-30d` wording.** `packages/domain/src/comms.ts` describes `feedback-30d` as "Review request only if they're happy". If the business then publishes or promotes the resulting reviews, a positive-only funnel risks the "misleading way" ban (O: DMCC Sch 20 para 13(2) and (5)(i)). Platform and CMA rules on selective invitations need checking (U). Send the review request to everyone, separately from the score.
2. **Any incentive for a review.** "Commissioning" includes "incentivising by any means" (O: para 13(5)(g)). An incentivised review must say so, and concealing it is banned (para 13(1)(b)). Offer no discounts, prize draws or gifts.
3. **Trust marks, accreditations or review counts you don't hold yet.** "Displaying a trust mark, quality mark or equivalent without having obtained the necessary authorisation" is banned (O: para 3), and so are false approval claims (para 4). Showing only the five-star reviews is publishing reviews in a misleading way (para 13). This covers manufacturer-accredited badges, REFCOM, TrustMark and the competent-person scheme.
4. **The kitchen-table close and false urgency.** Avoid "today-only" prices (O: para 7), giving the impression the customer "cannot leave … until a contract is formed" (para 26), and repeated chasing (para 28). The off-premises duties make signing in the home risky anyway (O: CCR regs 10 and 19).
5. **Verbal promises that never get written down.** "Silent", "halves your bills" and "done in a day" become contract terms if the customer relied on them (O: CRA s.50). Write down and qualify every claim, or don't make it.
6. **Starting inside the cooling-off period without a proper express request, or counting from the wrong day.** If work starts without one, the customer can cancel and owe nothing for the work done (O: CCR reg 36(6)). Missing cancellation information can stretch the period by up to 12 months (reg 31(3)). See the sales-contract point in §2.4.
7. **Surprise extras.** Avoid pre-ticked add-ons (O: CCR reg 40(2), refundable under reg 40(4)) and "while we're here" work agreed verbally on the day (CRA s.50(4)).
8. **Silent install days and messages nobody can answer.** Watch for: no ETA, no end-of-day update, SMS from an alphanumeric (no-reply) sender with no phone number, and emoji or curly quotes that cut each SMS part to 70 characters and multiply the cost (R: [N1]).
9. **Asking for the review, or calling the job finished, while the paperwork is incomplete.** Paperwork includes the EIC, F-gas record, warranty registration, maintenance information (5 days, reg 40) and the Building Regs certificate (30 days, reg 20(3)). A handover pack that is only a folder of manufacturer PDFs also counts here.
10. **Buying an enterprise field-service suite, or stacking several apps, for four installs.** The in-house app plus the roughly $45–50 a month stack in [`services-and-costs.md`](services-and-costs.md) covers every pattern above (R). Also don't copy enterprise in-home selling flows such as tablet good/better/best closes; they conflict with item 4. Field-service suite pricing wasn't checked (`null`).

---

## 7. Gaps against the current code (read-only review)

These come from `packages/domain/src/comms.ts`, `packages/domain/src/documents.ts` and `docs/pilot-architecture.md`. Nothing was changed.

| Gap | Suggested change | Why |
|---|---|---|
| `feedback-30d` makes the review request depend on happiness | Split it into `feedback-30d` (internal score and questions, everyone) and `review-request` (everyone, same wording, opt-out line) | A1; DMCC Sch 20 para 13 |
| `cancellationEndsOn = date(now) + cancellationDays` at acceptance | Get legal advice. If goods plus install is a sales contract, set the end date from kit delivery or possession (reg 30(3)). | §2.4 |
| No event when the Building Regs certificate or warranty confirmation arrives | Add a `certificate-issued` event that updates the handover pack | Reg 20(3) due within 30 days; P24 |
| No change-of-season check | Add a `seasonal-check` cron event | P25, D13 |
| Visit reminders don't explicitly carry the visitor's photo | Add the visitor's name and photo to `survey-reminder` and `install-day-before` | D1 |

---

## 8. Verification queue (for a follow-up run with web access)

All of these are `null` or U today. Send a follow-up message to re-run with search, or raise `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`.

**Benchmarks**

- [ ] **Octopus Energy (octopus.energy):**
  - Does the survey cost anything, and is the fee refundable?
  - What happens at the survey (heat loss, who visits)?
  - How is the final quote presented?
  - How many install days, and what communication on each?
  - What's in the handover?
  - What app monitoring is offered, and any guarantee?
- [ ] **Aira (airahome.com/uk):** the survey method (in person or remote), install duration, guarantee length and conditions, app features, the aftercare cadence.
- [ ] **BOXT (boxt.co.uk):** the air-con quote-to-install flow (is there a survey or video call?), install-day messages, care plan terms, Trustpilot review count and rating.
- [ ] **Heat Geek (heatgeek.com):** what an Elite installer commits to (design, monitoring, guarantees), and handover pack contents.
- [ ] **British Gas (britishgas.co.uk):** what the engineer-tracking message contains and when it is sent; HomeCare service intervals.
- [ ] **Jobber (help.getjobber.com):**
  - the exact Client Hub feature list
  - reminder timing options
  - on-my-way text content
  - review request timing and wording
  - offline capability of the mobile app
- [ ] **ServiceTitan (servicetitan.com):** the technician-profile message contents, how offline mode works, form requirements, timesheet model.
- [ ] **Tesla (tesla.com/support):** which photos customers upload, and the milestone names in the app.
- [ ] **Sunrun (sunrun.com):** the project-tracker stages and update cadence.
- [ ] **Hometree (hometree.co.uk):** heat pump aftercare and cover terms.

**Rules**

- [ ] **CMA:** guidance on fake reviews under the DMCC Act 2024. Does it cover selective invitation ("review gating")?
- [ ] **ICO:** is a review or feedback request "direct marketing" under PECR?
- [ ] **Google Business Profile and Trustpilot:** rules on selective solicitation and incentives.
- [ ] **Trading Standards Business Companion, or a solicitor:**
  - Is goods plus installation a "sales contract" under CCR?
  - When does the cancellation period end for installed AC?
  - Does reg 28(3)(c) apply?
- [ ] **Competent-person scheme operator (e.g. BESCA, NAPIT, Certsure):**
  - Who issues the Building Regs certificate to the occupier, and when?
  - Does Part L1 (and so reg 40) apply to a split AC install in an existing dwelling?
- [ ] **Mitsubishi Electric and Panasonic:** warranty registration deadlines for splits.

---

## Sources

**Legislation (O).** Read from legislation.gov.uk text cached in this workflow on 18 October 2026, not opened live. The date in brackets is the "last updated" date in the cached copy.

- Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013, SI 2013/3134, regs 5, 10, 12, 19, 28, 30, 31, 34, 36 and 40 and Schedule 2 [2026-01-01]: https://www.legislation.gov.uk/uksi/2013/3134. Per-provision pages, for example https://www.legislation.gov.uk/uksi/2013/3134/regulation/36 and https://www.legislation.gov.uk/uksi/2013/3134/schedule/2
- Consumer Rights Act 2015, ss. 15, 49, 50 and 52 [2026-09-28]: https://www.legislation.gov.uk/ukpga/2015/15/section/50 (and /section/15, /section/49, /section/52)
- Digital Markets, Competition and Consumers Act 2024, Schedule 20, paras 3, 4, 7, 13, 23 and 26–28 [2026-04-06]: https://www.legislation.gov.uk/ukpga/2024/13/schedule/20
- SI 2025/272, DMCC Act 2024 (Commencement No. 2) Regulations 2025. Schedule 20 and Part 4 Chapter 1 are in force from 6 April 2025: https://www.legislation.gov.uk/uksi/2025/272
- Privacy and Electronic Communications (EC Directive) Regulations 2003, SI 2003/2426, reg 2 (definition of "electronic mail") and reg 22 [2026-02-05]: https://www.legislation.gov.uk/uksi/2003/2426/regulation/22
- Building Regulations 2010, SI 2010/2214, regs 20, 40 and 44 and Schedule 3 [2025-12-20]: https://www.legislation.gov.uk/uksi/2010/2214

**Design guidance (D).** Fetched directly this session from the GOV.UK Design System source, commit `a1bfd60d1e0fcc2de52a1d357b934c3098ec62a6`:

- Confirmation pages: https://github.com/alphagov/govuk-design-system/blob/a1bfd60d1e0fcc2de52a1d357b934c3098ec62a6/src/patterns/confirmation-pages/index.md (live: https://design-system.service.gov.uk/patterns/confirmation-pages/)
- Check answers: https://github.com/alphagov/govuk-design-system/blob/a1bfd60d1e0fcc2de52a1d357b934c3098ec62a6/src/patterns/check-answers/index.md
- Complete multiple tasks (task list): https://github.com/alphagov/govuk-design-system/blob/a1bfd60d1e0fcc2de52a1d357b934c3098ec62a6/src/patterns/complete-multiple-tasks/index.md

**Repo research (R).** Each carries its own sources and grades:

- [`docs/research/commissioning-standards.md`](commissioning-standards.md): F-gas label and record (Daikin installer guide), EIC and Part P (IET and council leaflets, grade S), Daikin warranty registration within 90 days (third-party copy of the Daikin UK policy, grade S), MCS 020 noise (§9).
- [`docs/research/services-and-costs.md`](services-and-costs.md): SMS length rules ([N1], GOV.UK Notify pricing page source), alphanumeric senders being one-way, the Vercel 4.5 MB body limit, the $45–50 a month stack.
- [`docs/best-in-class.md`](../best-in-class.md): earlier website and operations benchmark (July 2026).
- Code read, not changed: `packages/domain/src/comms.ts`, `packages/domain/src/documents.ts`, `docs/pilot-architecture.md` (the `proposal-accepted` row).

**Benchmarks (U, not opened this session):** octopus.energy · airahome.com/uk · boxt.co.uk · trustpilot.com/review/boxt.co.uk · heatgeek.com · heatpumpmonitor.org · britishgas.co.uk · getjobber.com · help.getjobber.com · servicetitan.com · tesla.com/support · sunrun.com · hometree.co.uk
