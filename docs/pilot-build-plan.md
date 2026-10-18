# Pilot build plan: four homes, end to end

The build brief for release one of Dang, It's Hot as a working installation
business, not just a quoting funnel. Written 18 Oct 2026 after a full audit of
this repo plus an outside brief (ChatGPT's "Coolco" master brief), which was
treated as a challenge, not a spec.

**The release-one test, kept from the outside brief because it's the right
one:** can we take each of the four pilot households from first price through
a real three-day installation, commissioning, handover and payment, with
virtually no admin improvisation? Everything below serves that sentence.
Anything that doesn't is cut.

Design principle, in your words: slick and smooth, functional, not overly
complex. In practice: one next action per screen, defaults everywhere,
nothing typed twice, and nobody (customer, surveyor, installer, owner) ever
has to ask "what now?".

---

## 1. Where we actually are

The repo is strong up to the moment a customer says yes, and mostly theatre
after it. That's the honest one-liner.

### Genuinely strong (keep, build on)

| Asset | Where | Why it matters for the pilots |
| --- | --- | --- |
| Instant price funnel | `/quote`, `packages/domain/src/pricing.ts` | Real, deterministic, server-recomputed. Becomes the "list price" every pilot discount is measured against. |
| Project timeline + pure reducer | `/p/[id]`, `domain/project.ts` | The right shape for the customer hub. Every transition already goes through one tested reducer, and the event log is the customer's updates feed. |
| Design rules + equipment selection | `domain/design.ts` | Eight rules with traffic lights, pipe and charge maths, BOM. Never wired to a real project, but the engine is sound. |
| Installation OS | `domain/install.ts` | Evidence-based runsheet with reading windows and QC scoring. Exactly the right idea for the installer app. Demo-only today. |
| Schedule + procurement planners | `domain/operations.ts`, `/ops/schedule`, `/ops/procurement` | Read real projects, but the BOM is regex-guessed from label strings. |
| Ops CRM basics | `/ops/quotes/[id]` | Notes, next action, due-today list, lost reasons. |
| Emails, crons, health | `lib/email.ts`, `lib/project-notify.ts`, `/ops/status` | Resend wired, demo mode safe, a status page that tells you what's broken. |
| Security model | API routes + service role, no keys in the browser | Simple and right. We keep it rather than moving to RLS (see §7). |

Baseline: `pnpm test` passes (94 domain tests, 6 web tests), typecheck clean.

### Demo-only or missing (the pilot gap)

Verified in code:

- **Nothing after acceptance persists properly.** Design studio, Installation
  OS and the runsheet player run in the browser on fixed sample data. No
  design, BOM, install job, evidence, commissioning record, cost or defect is
  stored anywhere. "Installation complete" is one button that stamps a date.
- **No people.** One shared ops password, no users, no roles, no record of who
  did what. The installer is a bio string shown to the customer.
- **No surveyor tooling.** After an in-person visit ops can type a free-text
  summary. No measurements, no photos, no editing rooms, no annotation.
- **No money.** "Pay £150 & confirm" flips a flag to *paid* with no payment
  taken. No deposit, invoice, balance or receipt.
- **No costs or margin anywhere.** Per-job cost and margin don't exist; only
  planning assumptions in the finance model.
- **No customer identity.** UUID links only, one property per quote,
  `/portal` is a "coming soon" page.
- **No legal plumbing.** Acceptance stores only a timestamp: no terms version,
  no cancellation notice, no signature. The funnel has no terms or privacy
  links.
- **No documents, no handover pack, no aftercare.** The completion email
  promises handover documents that don't exist.

### Promises the site makes that the code doesn't keep

These go first, because pilot customers will read them:

1. "Good news, we cover {district}" shows for **any** valid UK postcode
   (`components/quote/steps.tsx:273`).
2. "Money comes off your bill automatically" if we miss an SLA. No code
   computes SLA credits, and the remedies aren't shown.
3. "Price locked" is unreachable from the web funnel. It never collects
   electrics or outdoor photos, so confidence caps at 78, below the 80 needed
   for "high".
4. "It can go down, never up", but ops can issue any final total.
5. "Most homes are installed in a single day" vs the engine's 3 days for a
   typical 3-bed vs the FAQ's "typically two".
6. The quote email says the price "doesn't expire"; the terms say 60 days.
7. A demo installer ("240+ installs") sits on a page that says "Nothing here
   is a mock-up". There's also track-record copy ("a pattern we fit week in,
   week out") from before the first install.
8. "F-Gas certified engineers" and "5-year parts & labour warranty" are both
   hard-coded and true only once the certified installer and the
   manufacturer warranty terms are confirmed.
9. Finance examples with a representative APR are shown with no lender in
   place. That's a regulated financial promotion; hide it until a broker or
   lender exists.
10. The terms say a deposit confirms the booking; no deposit exists.

---

## 2. Audit of the outside brief

### Adopt (the repo is missing these and they matter)

1. **One source of truth.** The surveyed rooms flow into design → proposal →
   BOM → purchase orders → runsheet → commissioning → warranty. The engines
   exist; the wiring doesn't. This is the single biggest win.
2. **A real visual plan on real photos.** Installers open the job and see the
   actual wall with the unit drawn on it, the core hole, the pipe route and the
   measured lengths.
3. **A human signs the design before a price is fixed.** Heat load stays a
   rule-of-thumb aid labelled as such; a qualified technical lead selects
   capacities and signs. Auto-approve stays in the engine for later, behind a
   setting that is **off** for the pilots.
4. **VAT as configuration, never hard-coded.** Today every price is
   "VAT inclusive" at an implied 20%. See §6: the real answer may be 0%.
5. **Per-job cost, margin and pilot discounts** measured against a genuine
   list price.
6. **Roles with qualification gates.** F-gas steps can only be signed by
   someone holding a current certificate, and electrical steps by the
   competent person. Subcontractors see their jobs, never margins.
7. **Payments recorded from verified webhooks**, never from a redirect.
8. **A real acceptance record** with cancellation rights and an early-start
   request (this one shapes the pilot calendar, §9).
9. **"On my way" SMS with an ETA the installer picks**, message previewed, no
   fake GPS.
10. **Defects tracked separately from completion, handover and payment.**
11. **A pilot learning loop.** The point of the four pilots is what they
    teach.

### Change (right instinct, wrong shape for us)

| Outside brief says | We do instead | Why |
| --- | --- | --- |
| Online price is only "indicative" | Keep the instant price; call it "your price, confirmed at your survey". Fixed only after survey + engineer sign-off. Any increase must name its reason. | The instant price is our differentiator and is already honest via the confidence score. We fix the promise, not the funnel. |
| Stages: survey after quote acceptance (our current order) | Reorder to **price → survey → design & proposal → accept → book → kit → install → handover → aftercare** | Today the customer accepts a "final" quote before anyone has seen the house. For in-person pilots, survey first. |
| Rename to Coolco, white/cool-blue, "Perfect temperature, perfectly installed" | Keep **Dang, It's Hot**. Keep the cheek in marketing, but use calm, precise language at the serious moments: contract, money, safety, commissioning. | The brand, collateral and design system are built. But do adopt the **heating-and-cooling** framing (§6: it's what planning rules and VAT relief reward). |
| ~60-table relational schema | ~14 new tables, keeping our JSONB-snapshot + pure-reducer pattern | It's tested, replayable and fast to change, and four pilots don't need 60 tables. |
| 12 server-generated PDF types | Print-perfect HTML documents from immutable snapshots ("Download PDF" = print) | We already do collateral this way. Server PDF can come later. |
| Full offline PWA | Outbox queue: actions and photos queue on the phone, retry, and show "3 unsynced" until acknowledged | London houses mostly have signal. The queue covers lofts and gardens without a service-worker project. |
| A 26-event comms plan | About 20 templated events through one outbox with idempotency, demo mode and preview | Same coverage, one mechanism. |
| Separate `/portal/*` routes | The project hub at `/p/[id]` **is** the portal; `/portal` = sign-in + "your homes" | Don't build two customer surfaces. |
| `/ops/surveys/:id` | `/field/survey/[id]`: the surveyor is on a phone, in the field app | Same tool for surveyor and installer, same login. |
| Good / Better / Best on the instant estimate | Two options on the **proposal** (Standard vs Quiet / Premium indoor units, same design) | Choice makes sense once the design is real. We learn which tier people pick. |

### Drop for release one

Inventory and warehouse, supplier scraping, WhatsApp, recurring service
billing, a full permissions-matrix UI, multi-crew optimisation, AI heat load,
RoomPlan/LiDAR, server-side PDF, a native installer app (the field app is
mobile web; the Expo app stays customer capture), and further public pages
(`/systems`, `/pricing`, `/service`). The four pilots don't arrive through
marketing, so the public site only gets honesty fixes. `/systems` comes once
the catalogue is verified.

### What the outside brief missed

1. **Who is the F-gas certified company?** If Dang It's Hot Ltd doesn't hold
   company F-gas certification, the refrigerant work has to be done under a
   company that does. That decides who contracts with the customer, whose
   certificate goes in the handover pack, and what the warranty is. It needs
   deciding before Pilot 1's proposal.
2. **Manufacturer warranty depends on installer status.** Extended warranties
   usually need an accredited installer and registration within a deadline.
   The "5 years" claim has to come from settings and catalogue, and
   registration is a tracked task with a due date.
3. **The 14-day cancellation clock shapes the calendar.** Installs within 14
   days of acceptance need the customer's express early-start request on a
   durable medium (email), or they must wait. Acceptance captures it, the
   confirmation email is the durable copy, and readiness checks it.
4. **Asbestos and old fuse boards.** Pre-2000 homes get drilling risk
   prompts. Old fuse boxes can have asbestos flash guards. Suspected asbestos
   is a stop-work issue, not a note.
5. **Defrost water in heating mode.** Outdoor units shed water in winter, so
   the drainage and ice-path check belongs in survey and commissioning.
6. **The electrical certificate arrives later.** The competent-person scheme's
   building-regs certificate can take weeks, so handover allows "pending" and
   chases it before the job closes.
7. **The most valuable pilot data is whether self-survey works.** The
   business model rests on "structured customer capture replaces the surveyor
   visit". Each pilot does the funnel *and* gets a measured survey, so we can
   diff them room by room: size band vs measured area, outdoor guess vs
   chosen, electrics guess vs found, pipe run estimate vs measured. Four data
   points won't prove it, but they will show where it breaks.
8. **Batch the surveys, stagger the installs.** Survey all four in week one
   (cheap, fills the pipeline), then install simplest first, one per week. That
   way every install's lessons reach the next one (§9).

---

## 3. The target journey, stage by stage

Eight customer stages on the existing horizontal timeline. Each one has a
single next action, a gate in the reducer (not the UI), and only real states:
no "delivered" inferred from an ETA, no "paid" from a button.

```
price → survey → proposal → booked → kit → install → handover → aftercare
```

### Stage 1 · Price (online, about 2 minutes)

**Customer:** the existing funnel, with these changes:
- Heating-and-cooling framing.
- Real service-area check (configured outcodes, including the pilot areas);
  outside the area → "we're not there yet, want a heads-up?".
- Terms and privacy links.
- Operational vs marketing consent as separate ticks.
- Optional "lock your price" step for outdoor-spot and fuse-board photos, so
  "high" confidence becomes reachable.
- The result ends on one CTA: **Book my home survey**.

**Ops:** a **New pilot** form (name, email, phone, address, about 30 seconds)
creates the quote and project on someone's behalf. Or send a household a
funnel link carrying a pilot token, so their run through the real funnel is
tagged automatically. That's better: it tests the funnel too.

**Have:** almost all of it. **Build:** service area, consent, legal links,
lock-your-price photos, pilot tagging and the New pilot form, plus the copy
fixes from §1.

### Stage 2 · Survey (home visit, 60–90 minutes)

**Customer:**
- Picks a slot (the slot picker exists for site visits; generalised).
- Email confirmation with calendar invite, SMS reminder the day before, and
  "on my way, about 20 min" SMS.
- Portal shows what we'll check and what they need to do (loft and fuse-board
  access, think about where units could go).
- Afterwards: "Survey done. Your design arrives by {date}".

**Surveyor**, at `/field/survey/[id]` on a phone. Prefilled from the
customer's own survey, so they confirm and correct rather than start blank:
1. Site and people: decision maker and owner (authority to contract), access,
   parking.
2. What they want: rooms, priorities (quiet, discreet, heating use), timing.
3. The house: construction and wall type, era, loft access, asbestos prompts
   for pre-2000 homes.
4. Each room:
   - Measured dimensions and ceiling height.
   - Windows, orientation, sun, occupancy.
   - Candidate unit position: photo → draw the unit.
   - Pipe route to outside, with measured length and height drop.
   - Condensate: gravity or pump.
   - Obstacles.
5. Outdoor:
   - Position photo → draw the unit.
   - Distance to the nearest neighbouring window.
   - Base or bracket, height and access equipment.
   - Defrost drainage.
6. Electrics:
   - Board photo, spare ways, RCD type.
   - Cable route and length.
   - Old-board asbestos check.
7. Permissions and risks:
   - Planning permitted-development checklist (§6).
   - Conservation, listing or Article 4 from the property record.
   - Structural, working at height.
8. Assumptions and unknowns.
9. Submit → requests technical review.

A completeness meter shows exactly what's missing per section. Big touch
targets, one-handed. Photos upload in the background through the outbox.

**Gate:** the survey is complete only when every room has measurements and a
tagged photo, and outdoor, electrics and permissions are answered.

**Have:** slot booking, photo upload, room model (`areaM2` exists but is
unused). **Build:** the field survey flow, the media library with tags, the
annotation tool, the self-survey diff, and survey-stage comms.

### Stage 3 · Design and proposal

**Technical lead**, at `/ops/projects/[id]/design`:
- `designSystem` runs on the **measured** survey with the **real catalogue**,
  and shows the rule lights.
- The preliminary load is shown, labelled "rule of thumb, for review".
- They pick capacity per room, overriding with a reason.
- They confirm the outdoor model. Multi-split combinations must come from the
  verified compatibility table, or the design is blocked.
- They confirm runs, pumps and electrics, then sign: name, qualification,
  timestamp.
- Signing locks the annotated photos as the **approved layout**.

**Owner**, at `/ops/projects/[id]/proposal`:
- One or two options (Standard / Quiet).
- Each option shows:
  - **List price:** the pricing engine, re-run on the surveyed design.
  - **Cost build-up:** equipment and materials from catalogue costs, labour
    hours × rate, subcontract, access hire, delivery, contingency.
  - **Gross margin** before and after discount.
- Pilot discount with reason, tax treatment from settings, inclusions and
  exclusions, validity date. Issue → email.

**Customer**, at `/p/[id]/proposal`, the page that has to feel premium:
- Summary card: total, install days, earliest dates.
- **Your rooms:** a card per room with *their own photo and the unit drawn on
  it*, the unit in plain English ("whisper-quiet at 19 dB, app control"), and
  why that size.
- **Outside:** the annotated outdoor spot. **How the pipes run.**
- What's included and what isn't. The three-day plan. A simple price
  breakdown with the pilot discount as its own line. Warranty, validity.
- Option toggle. **Accept · Ask for changes · Decline.**

Acceptance:
1. Review summary.
2. Key terms in plain English, cancellation rights and model form.
3. "Want us to start within 14 days?" (express request, plus acknowledging
   that a proportionate payment applies if they cancel after work starts).
4. Type full name → **I accept and agree to pay £X**.
5. Confirmation screen, plus an email with the contract (the durable copy)
   and the printable document.

**Gates:**
- Issuing needs: design signed, tax treatment confirmed, margin ≥ minimum (or
  an admin override with reason), and a validity date.
- An accepted version is immutable. Changes before acceptance make a new
  version; changes after it make a numbered **variation** with a price delta
  and its own acceptance.
- A total above the instant price must state its reason to the customer
  ("you added a room", "your fuse board needs an upgrade").

**Have:** design engine, final-quote stage (one number). **Build:**
catalogue, persisted design and sign-off, costing, proposal builder,
proposal page, acceptance, contract document, versions and variations.

### Stage 4 · Booked

**Customer:**
- Picks from three-day blocks we publish (for example Tue–Thu).
- Pays a deposit if settings ask for one: hosted card checkout, or bank
  transfer with a reference.
- Sees **confirmed** dates only.
- Meets the real team: name, photo, role, and qualifications actually held.
- Ticks the prep checklist (it exists).

**Owner:** assigns crew (installer, F-gas technical lead, electrician). The
system checks each person's qualifications are current for the steps they'll
sign. Conflicts show on the schedule. Owner can also set or move dates for
the customer (today only customers can).

**Gate:** booked = dates + qualified crew + deposit if required + the
cancellation period ended, or early start requested.

### Stage 5 · Kit

**Owner:**
- Purchase orders are generated from the approved BOM, grouped by supplier:
  Required → Approved → Ordered → Supplier confirmed → Dispatched →
  Delivered → Inspected.
- Destination: customer, us, or installer. Partial deliveries allowed.
- Actual cost captured (feeds margin).

**Installer:** "Check kit" on arrival: photo or scan each box's serial against
the expected model. Damage or shortage raises an issue.

**Customer**, conservatively: "Ordered" → "Supplier confirmed for Wed" →
"Delivered and checked by your installer".

**Gate:** ready to install = every required line inspected (or marked
installer van stock) + compliance checklist approved + RAMS acknowledged.

### Stage 6 · Install (three days)

**Customer:**
- SMS the evening before; "on my way" SMS with ETA.
- Today's plan on the portal, with the ~30 minute power-off warning.
- End-of-day update with two or three photos the installer picked ("Day 1
  done: holes drilled and sealed, brackets up. Tomorrow: units on the
  wall").
- Variations to approve in the portal; tap-to-call the crew lead.

**Installer:** the field app (§4).

**Gate:** install complete = every evidence slot Pass, or N/A with a reason,
and every exception reviewed by the technical lead.

### Stage 7 · Handover

**Technical lead** (role-gated) records commissioning:
- Strength and tightness test, vacuum and decay hold.
- Refrigerant added (g).
- Temperature split in cooling **and** heating.
- Noise at the boundary, condensate and defrost-drain test.
- Serials per unit. Then signs.

**Electrician:** the electrical installation certificate, uploaded or marked
"pending from scheme" with a chase date.

**With the customer**, on the installer's phone:
1. Walkthrough checklist: remote, modes, app pairing, filter cleaning, and
   what's normal (defrost steam, drips).
2. The **handover pack** is published: equipment by room with serials,
   manuals, warranty (registered or due by), commissioning certificate,
   electrical certificate or "pending", care guide, contacts.
3. The customer signs **All good** or **There's a snag**. Snags become
   defects with an owner and a date.
4. The balance invoice follows the agreed terms.

**Gates:**
- Handed over = pack published + walkthrough done + sign-off or snags
  recorded.
- **Closed** = balance paid + warranty registered + electrical certificate
  received + no critical defects open.

Completion, handover, customer acceptance, defect closure and payment are
five separate facts, tracked separately.

### Stage 8 · Aftercare

- Day 7: "How's it running?" check-in.
- Day 30: feedback (a 0–10 score plus three questions; ask for a public review
  only if they're happy).
- Warranty registration confirmed.
- 12-month service reminder.
- "Report a problem" from the portal → defect → callback visit.
- Optional service plan offer, never auto-charged.

---

## 4. The installer experience (`/field`)

For gloved hands, bright gardens and small screens: big targets, high
contrast, one primary action per screen.

**Today:**
- A card per job: address with a maps link, day N of 3, start time.
- Parking and access notes; tap to call the customer.
- Crew; risk flags (height, asbestos prompt, pets); kit status.

**Job pack**, read before leaving home:
- Approved layout: annotated photos per room and outside.
- Equipment by room with expected models.
- Materials checklist; tools list (standard kit plus job-specific: condensate
  pump, tower for high brackets).
- RAMS to acknowledge; customer instructions.

**Day runsheet:** the existing 11-phase Installation OS, mapped onto three
suggested days. The runsheet stays phase-ordered and the actual day is
logged.

| Day | Phases |
| --- | --- |
| 1 · Prep & building work | Arrival, protection, condition photos, RAMS, marking out (wall-services scan), core drilling, wall plates, outdoor base or bracket |
| 2 · Mechanical & electrical | Kit and serial check, indoor units, outdoor unit, pipework, condensate, electrical (competent person only) |
| 3 · Test, commission, hand over | Pressure test, vacuum, release and leak check (F-gas only), commissioning in heating and cooling, electrical tests, walkthrough, paperwork, finished photos, clean |

Every step has evidence slots, as today, plus:
- Real camera photos and video.
- Readings checked against windows; serial capture.
- Customer signature.
- Statuses **Pass / Fail / Blocked / N/A**, with a reason required for the
  last three.
- Steps marked `fgas`, `electrical` or `tech-lead` are locked unless the
  signed-in person holds that current qualification.
- Out-of-window readings become exceptions for the technical lead; an
  ordinary installer can't clear them.

**Quick actions**, always one tap away:
- **On my way:** pick an ETA (20/30/45/60 or type one) → preview → send.
- **Arrived · Pause · Resume:** these also write the time log.
- **Raise issue:** defect, shortage, safety, clarification or customer
  instruction, with a photo.
- **Request variation:** description and estimated cost → owner → customer
  approval.
- **End day:**
  1. Summary.
  2. Pick customer photos → preview the customer update → send.
  3. Two-minute learning prompts (§5).

**Offline:** an outbox on the phone queues evidence, photos and actions, with
a visible unsynced count. Nothing shows as "sent" until the server
acknowledges it. Gate transitions (complete day, commissioning sign-off)
refuse to run offline.

---

## 5. The owner's experience (`/ops`)

- **Board:** projects by stage. Each card shows customer, area, value, next
  action, owner, due date, blockers. Search across name, address and
  reference.
- **Command centre** (`/ops/projects/[id]`), one page with sections:
  - Overview: stage, gates and blockers, next action.
  - Survey, with the self-survey diff.
  - Design; Proposal (versions, options, margin).
  - Schedule and crew; Kit (POs).
  - Install (runsheet progress, evidence, issues).
  - Handover and documents; Money (invoices, payments); Messages (every send,
    with status).
  - Time and costs (estimate vs actual); Learnings; Activity log.
- **Catalogue and rates** (`/ops/catalogue`):
  - Equipment with specs, buy cost, supplier, verified date and source,
    status (available / uncertain / discontinued) and confidence (verified /
    stale / provisional).
  - Materials, labour rates.
  - Indoor/outdoor compatibility (multi-split combinations must be listed,
    with source).
  - CSV export.
  - Seeded with real Panasonic / Daikin / Mitsubishi model *names* marked
    provisional, with **blank costs** until you enter supplier quotes. No
    invented prices.
- **Settings:**
  - Company legal details; VAT status and tax codes (with rationale and an
    accountant-confirmed flag).
  - Deposit % and timing, payment terms, minimum margin, discount codes
    (`PILOT15`, `PILOT30`, `PILOTCUSTOM`).
  - Service area outcodes; SLA on/off; install-block length (default 3).
  - Terms version with review status.
- **Staff:** people, roles, qualifications with certificate numbers, expiry
  and evidence.
- **Messages:** outbox log, previews, resend, per-template on/off.
- **Pilots** (`/ops/pilots`): the comparison page (§9) and CSV export.
- **Daily digest:** the existing email, extended with blockers, overdue next
  actions and today's installs.

---

## 6. Compliance built into the workflow

The software orchestrates approvals; it never replaces them. Statutory items
can't be overridden. Internal-process items can, by an admin, with a reason.
These are working summaries; verify with the regulator, an accountant or a
solicitor where marked.

| Requirement | What the product does | Override? |
| --- | --- | --- |
| **F-gas:** installing and commissioning split systems needs company certification plus individually certified engineers | Company certificate number in settings; engineer certificates with expiry on staff records; refrigerant steps and commissioning sign-off locked to current holders | No |
| **R32 only:** single splits under 3 kg with refrigerant GWP ≥ 750 can't be placed on the GB market since Jan 2025 | Catalogue rejects non-compliant single splits (R32 has a GWP of 675) | No |
| **Electrical (Part P):** a new circuit in a dwelling is notifiable; a registered competent person self-certifies | Electrician's scheme membership on staff record; electrical certificate and notification tracked; job can't close without it | No |
| **Planning permitted development** (England, Class G of Part 14, as amended from 29 May 2025): the heat pump must not be used solely for cooling; noise ≤ 42 dB(A) at the neighbour's assessment position, calculated under the current MCS 020 standard; ≤ 1.5 m³ for houses; up to two units on detached houses; sited to minimise visual impact; listed, conservation and Article 4 cases need checks | Survey records the assessment, the noise rule computes it, and the technical lead approves it. The system never concludes "no planning needed" by itself. Failing permitted development → manual planning route. *Verify the current Class G text before Pilot 1.* | No |
| **VAT:** if not registered, no VAT; if registered, installing qualifying fixed air-source heat pumps in homes may be zero-rated as energy-saving materials until 31 Mar 2027, then 5%. HMRC treats many reversible units as air-source heat pumps; cooling-only units don't qualify | Tax code per proposal with rationale; a proposal can't issue on an unconfirmed code without an admin override. **Accountant to confirm.** | Admin, with reason |
| **Cancellation rights** (Consumer Contracts Regulations 2013): 14 days from contract; give information and the model form, or the period runs to 12 months; no work inside 14 days without an express request on a durable medium; proportionate payment if cancelled after work starts | Built into acceptance and the confirmation email; readiness checks it; a cancel flow sits on the portal. **Solicitor to review wording.** | No |
| **Genuine reference prices:** a "was £X" must be real | Pilot discount always applied to the engine's list price for the surveyed design, both stored | No |
| **Financial promotions:** no finance examples without an authorised arrangement | Finance figures hidden until a lender or broker is set in settings | No |
| **Marketing consent** (UK GDPR / PECR) | Operational and marketing consent stored separately; marketing sends check consent | No |
| **Asbestos:** assess before drilling | Pre-2000 prompts at survey; suspected asbestos = stop-work issue | No |
| **Working at height** | High brackets flag access equipment in survey and job pack | No |
| **Manufacturer warranty:** registration and installer status | Warranty terms from catalogue; registration task with due date | Internal |
| Ownership and authority to contract | Survey captures owner and signatory; acceptance by that person | Internal |

The positioning consequence: planning rules and VAT relief both reward a
**heat pump that also cools**, not "air con". Marketing should say "cool in
summer, warm in winter", and handover should show customers the heating
mode.

---

## 7. Architecture decisions

Same rules as the rest of the repo: pure, versioned, tested domain code;
JSONB snapshots as truth; server is the authority; demo mode everywhere.

1. **Project v2.**
   - New stage list (§3); `schemaVersion: 2`; a `migrateProject()` lifts v1
     snapshots, so existing projects and `/p/demo` keep working.
   - Gates become one function, `readiness(project, context) → blockers[]`.
     The board, command centre, field app and reducer all read it.
   - Every blocker carries an owner and a next action.
2. **Auth: one small session layer, not Supabase Auth + RLS.**
   - Email magic links exchange for a signed, httpOnly session cookie (HMAC,
     Web Crypto, Edge-safe).
   - Staff sessions last 30 days on their phone.
   - Customer links in operational emails are per-recipient, expire in 30
     days and are single-use to exchange; a lost link means request another.
     That's one tap for parents, no passwords.
   - Every API route and server action checks role and ownership
     (`requireStaff`, `requireCustomerFor`). DB access stays service-role.
   - The shared ops password survives only as a demo-mode fallback.
   - This keeps the current security model, where the browser never touches
     the DB, instead of rewriting for RLS.
3. **New tables**, in migrations `0010`+. Money is in integer pence with
   explicit currency.

   | Table | Holds |
   | --- | --- |
   | `staff` | roles, qualifications |
   | `login_tokens` | magic-link tokens |
   | `customers` | contact and consents |
   | `media` | tag, room, annotations JSON, customer-visible flag, source |
   | `surveys` | versioned measured survey snapshot |
   | `designs` | versioned blueprint, overrides, sign-off |
   | `proposals` | versioned options, costs, tax, discount, acceptance record; immutable once accepted |
   | `catalogue_items` | equipment, materials, labour rates |
   | `compatibility` | verified indoor/outdoor combinations |
   | `purchase_orders` | lines, statuses, receipts |
   | `install_evidence` | append-only, idempotent on a client id, so offline retries are safe |
   | `issues` | defects, snags, blockers, variations: owner, next action, cost delta, customer approval |
   | `time_entries` | labour and travel log |
   | `invoices`, `payments` | unique provider event id for webhook idempotency |
   | `messages` | outbox: idempotency key, template version, rendered body, status, provider ref, retries |
   | `learnings` | pilot learning prompts |
   | `settings` | company, tax, deposit, margins, service area, terms |
   | `audit_log` | who did what |

4. **New pure domain modules**, each with `node --test` coverage:

   | Module | Covers |
   | --- | --- |
   | `survey-visit.ts` | measured survey, completeness, self-survey diff |
   | `costing.ts` | cost build-up, list price, discount, tax, margin guard, options |
   | `commissioning.ts` | record and certificate data from evidence |
   | `compliance.ts` | checklist template, statuses, statutory flags |
   | `comms.ts` | event → template → message, idempotency keys |
   | `money.ts` | invoices, balance, deposit rules |
   | `pilots.ts` | metrics, comparison, CSV |

   Changes to existing modules:
   - `design.ts` takes the catalogue as input, enforces compatibility, uses
     measured runs and records sign-off.
   - `install.ts` builds runsheets from the blueprint, maps days, gates
     roles, adds N/A, Blocked and Fail with reasons, and adds tech-lead
     sign-off.
5. **Providers, each with live, sandbox and demo modes.**
   - Resend (exists).
   - Twilio SMS. A one-way alphanumeric sender, so every SMS carries our
     phone number; we don't pretend replies arrive.
   - Stripe Checkout plus a verified webhook.
   - getAddress (exists); Supabase Storage (exists).
   - Demo mode records messages as "demo, not sent". Payments get a clearly
     labelled "simulate" button outside production only.
   - A banner shows TEST or DEMO mode.
6. **Documents** are print-perfect HTML from immutable snapshots, each with
   our identity, date, version, reference, customer and property, status, and
   the acceptance or approval block. Types:
   - Proposal; contract confirmation (with cancellation form); variation.
   - Invoice and receipt; commissioning certificate; handover pack.
   - Legal templates carry "needs legal review" until approved in settings.
7. **The photo annotation tool:**
   - The real photo with an SVG overlay. Tools: indoor unit, outdoor unit,
     core hole, pipe route, condensate, cable, obstacle, measurement label.
   - Normalised coordinates, so it renders at any size; pinch-zoom; undo.
   - Versions lock when the design is signed; export to PNG for documents.
   - It never pretends to know what's inside a wall.

---

## 8. Build order

Each phase ends with something a real pilot can use, plus tests: domain unit
tests per module, one browser E2E for the whole pilot path (extending
`scripts/e2e-funnel.mjs`), and security tests (customer A can't open B's
project, subcontractors never see margin, bad webhook signatures are
rejected, upload type and size limits hold).

| Phase | Builds | Unlocks | Size |
| --- | --- | --- | --- |
| **P0 Foundations + honesty** | Honesty fixes (§1). Auth, staff and roles; settings; audit log; outbox with demo mode; project v2 + migration + `readiness()`; New pilot form; service area | Create the four pilot projects; invite the households | L |
| **P1 Survey** | Field survey flow; media with tags; annotation tool; self-survey diff; survey booking, reminders and on-my-way SMS | Survey all four homes | L |
| **P2 Design + proposal** | Catalogue and compatibility; persisted design with sign-off; costing, margin, VAT, discounts; proposal page; acceptance with cancellation and early start; contract document; versions and variations | Send four proposals | L |
| **P3 Book + kit** | Install blocks; crew with qualification checks; deposit (bank transfer + Stripe); purchase orders and kit check; compliance checklist; job pack | Confirm dates, order kit | M |
| **P4 Field install** | Runsheet from design with 3-day mapping; real evidence capture; role gates; issues and variations; time log; end-of-day updates; offline outbox | Install Pilot 1 | L |
| **P5 Handover + aftercare** | Commissioning record and sign-off; handover pack; customer sign-off and snags; balance invoice; warranty task; day-7, day-30 and 12-month schedule | Close Pilot 1 | M |
| **P6 Learning loop** | Learning prompts; pilot dashboard and comparison; CSV; lessons → checklist and engine changes | Pilot 2 is better than Pilot 1 | S |
| **P7 Demo + docs** | Four fictional demo scenarios (single split; multiple singles; verified multi-split; complex routing needing review); reset (development only); setup, admin, field and customer guides; approvals list | Show it to anyone without exposing a real home | S |

P0–P2 come before the first survey visit. P4 has to be ready by Pilot 1's
install day. P5 and P6 can finish during Pilot 1's install week.

---

## 9. The four pilots

**Privacy:** real addresses and household details go **only** into the
database through the ops UI, never into code, seeds, docs, screenshots or git
history. Committed demo data is fictional and labelled DEMO. Below, pilots
are referred to by area only.

| Pilot | Area | Check before we start |
| --- | --- | --- |
| 1 | Owner's home | Street spelling and postcode |
| 2 | Purley area | Purley is CR8; CR2 is South Croydon / Sanderstead. Confirm which |
| 3 | Croydon (CR0) | Exact address, owner, signatory |
| 4 | Pollards Hill (SW16) | Exact address, owner, signatory |

Nothing is assumed about room counts, construction, ownership or design until
each home is surveyed. The demo seeds show the four variations; the real
pilots get whatever their survey says.

**Suggested cadence:**
- **Week 1:** survey all four.
- **Week 2:** proposals out.
- **Weeks 2–5:** one install a week, simplest house first. Pilot 1 is the
  owner's own home, the most forgiving customer and easiest to revisit.
- Each install week: Monday prep and kit check, **Tuesday to Thursday
  install**, Friday snags plus a 30-minute review. Lessons land in checklists
  and engine constants before the next Monday.
- Installs within 14 days of acceptance need the customer's early-start
  request (§6).

**What we measure per pilot:**
- Instant price vs list price vs final price.
- Revenue and costs: equipment, materials, subcontract.
- Labour hours by person and stage vs estimate; travel; calendar install
  days vs the planned 3; rework hours.
- Unplanned materials; blockers; customer changes.
- Gross profit and contribution margin.
- Messages sent and inbound questions.
- Durations: survey, design, proposal; acceptance → install days.
- Satisfaction, complaints, defects at 7 and 30 days.
- **Self-survey accuracy.**

**Daily learning prompts** at End day, about two minutes:
- What took longer than expected? What was missing?
- What tool would have saved time?
- What should the survey have captured? What could have avoided a revisit?
- What confused the customer?
- What did you have to ask the office? Which checklist step was unclear?

`/ops/pilots` puts Pilot 1–4 side by side, with CSV export.

---

## 10. Decisions needed before the build

Each has the default I'll build with, so the build doesn't wait. Everything
here is configuration, not code.

| # | Decision | Default until you say otherwise |
| --- | --- | --- |
| 1 | Who holds company F-gas certification? Which engineers (Cat I) and which electrician (competent-person scheme)? If a subcontractor: who contracts with the customer? | Staff and qualifications are configurable; refrigerant and electrical gates stay locked until certificates are entered |
| 2 | VAT: registered or not? Accountant's view on zero-rating for air-to-air heat pumps | Not registered (no VAT line); tax codes configurable |
| 3 | Brands, models and supplier for the pilots | Catalogue seeded with model names as provisional, costs blank |
| 4 | Pilot pricing: discount level, deposit policy, payment terms | List price from the engine; `PILOT30` available; 0% deposit; balance due 7 days after handover |
| 5 | Payments: bank transfer, Stripe, or both? Is there a Stripe account? | Both built; bank transfer recorded by owner; Stripe in demo mode until keys are added |
| 6 | SMS provider account (Twilio) | Demo mode (recorded, not sent) |
| 7 | Terms, cancellation wording and service terms: who reviews? | Draft templates marked "needs legal review" |
| 8 | Survey fee for pilots (currently £150 credited) | Free for pilots, fee configurable |
| 9 | Warranty actually offered (manufacturer + workmanship) | Taken from catalogue and settings; "5-year" copy removed until set |
| 10 | Brand: confirm we stay Dang, It's Hot (the outside brief's "Coolco" is ignored) | Stay Dang, It's Hot, calmer voice at the serious moments |
| 11 | Target install weeks | Blocks configurable; nothing assumed |

---

## Sources (checked 18 Oct 2026)

- Permitted development amendment, SI 2025/560 (in force 29 May 2025): https://www.legislation.gov.uk/uksi/2025/560
- HMRC VAT Notice 708/6, energy-saving materials and heating equipment: https://www.gov.uk/guidance/vat-on-energy-saving-materials-and-heating-equipment-notice-7086
- Secondary summary of HMRC's air-to-air position (VENSAV3080, cooling-only excluded): https://www.acjourney.co.uk/learn/zero-vat-air-conditioning-uk
- Consumer Contracts Regulations 2013, cancellation and early start (Part 3; reg 36): https://www.legislation.gov.uk/uksi/2013/3134/part/3 · https://legislation.gov.uk/uksi/2013/3134/regulation/36
- Part P and the competent-person route (IET): https://electrical.theiet.org/bs-7671/building-regulations/part-p-england-and-wales/
- F-gas company certification (REFCOM): https://hf-group.co.uk/accreditations/refcom-f-gas-certification/
- GB 2025 single-split restriction: https://refindustry.com/news/great-britain-updates-guidance-on-2025-split-ac-f-gas-ban/
- MCS 020 noise methodology: https://mcscertified.com/wp-content/uploads/2024/11/MCS-020-Consultation-Response-Final.pdf
