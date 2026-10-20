# Known limitations

An honest list of what the pilot platform doesn't do, or does only
partly, as of 20 October 2026 (round 9 of the pre-launch review: §K48). None of these stops the four pilots; each
says what to do instead. Approvals that need a professional are in
[approvals-required.md](approvals-required.md).

## Catalogue, prices and engineering data

1. **The researched catalogue is mostly provisional and almost unpriced.**
   71 items (31 indoor, 40 outdoor units) from Panasonic, Daikin and
   Mitsubishi. Only 3 pair kits (6 items) have a cost, all public retail
   prices, one approximate and one for a superseded Mitsubishi model. No
   Panasonic price was found at all. Every Mitsubishi record is provisional.
   *Instead:* enter your trade prices for the models you'll fit, check them
   against the datasheet and mark them verified (see START-HERE step 9).
2. **Materials have no prices**: 0 of 51 rows. A proposal with an unpriced
   line needs the cost typed in, or an admin override with a reason.
3. **Labour rates and install durations are placeholders** (£220, £250 and
   £280 a day, £40 an hour; about 1 day for a single split, 2 to 3 for a
   multi-split). *Instead:* set your rates in Settings; after each pilot,
   compare the logged hours on the Pilots page and adjust.
4. **Multi-split compatibility is unofficial.** The 13 researched rules were
   partly worked out from capacities, port sizes and retailer bundles, not
   copied from the manufacturers' combination tables, and 14 model codes in
   them have no catalogue record. Designs only use a combination marked
   verified, after the technical lead checks the official table.
5. **Outdoor-unit sound power is missing for most units**, so the noise
   check at the neighbour's window (MCS 020(a)) can't run fully. The technical
   lead completes it from the datasheet. The check itself is an estimate:
   the heat pump's own level at the assessment position against 37.0 dB(A)
   (the 42 dB(A) limit includes an assumed 40 dB(A) background), with the
   reflecting surfaces the surveyor counts (Q2, Q4, Q8) and no barrier
   credit, so a position a barrier would save reads as review. *Instead:* the
   technical lead runs the full MCS 020(a) calculation (with any barrier) for
   anything in review, and confirms the 37.0 dB(A) figure against the
   current issue (approvals item 13).
6. **Room sizing is a rule of thumb**, labelled "for review, not a heat-loss
   calculation". The technical lead picks every size.
7. **Commissioning targets are set by the technical lead, per job.** No
   manufacturer test pressure, vacuum, decay, torque or drain-fall figure
   was verified, so the app shows the unverified candidates as hints, records
   every reading, and judges readings against the targets the technical lead
   sets from the manual (the pressure and vacuum tests also against the
   company's own defaults meanwhile: no fall beyond the gauge's resolution,
   500 micron).
   - *The pressure and vacuum decay tests are judged from their readings*
     (round 8's "a pressure drop isn't worked out" is closed, §K47): the
     end-of-hold pressure is corrected to the start temperature (absolute
     pressure × kelvin ratio, at a standard atmosphere of 1.01325 bar) and
     the test fails on any fall beyond the gauge's resolution, or the
     manual's allowance; the vacuum against 500 micron or a stricter manual
     figure, and its rise over the hold against the job's limit. A failed
     test can't be accepted, cleared by Pass or passed by a later target
     change: only a full retest clears it. But: *no manufacturer test
     pressure, hold time, allowance or rise limit was verified* (the
     manuals' hosts were unreachable again; the Daikin figures in the hints
     are search-engine extracts), so the technical lead sets the test
     pressure and PS, both hold times and the rise limit from the manual
     before signing; the barometric pressure on the day (about ±0.03 bar) and
     the thermometer's own error aren't modelled, so a fall within a
     hundredth or two of the allowance is worth a second look; a gauge
     resolution typed too coarse loosens the default allowance (it's printed
     on the certificate); and readings are put in order by the time the
     phone stamped them, so a phone with a badly wrong clock could mix two
     runs. *Instead:* set the targets from the manual before the install
     day, and use a phone with automatic time.
   - *The R32 room size is re-checked from the catalogue's factory charge.*
     The charge step flags an added charge over what the smallest room on
     the system allows, worked out with the catalogue's factory charge, not
     the nameplate figure the engineer types. *Instead:* if the nameplate
     differs, the technical lead re-checks total charge against the manual's
     minimum floor area table before signing.
8. **Model codes and generations need confirming** with the UK distributor
   before ordering (for example Daikin FTXM-A vs FTXM-R, Panasonic CKE vs
   ZKE, Mitsubishi MXZ VF3/VF4/VF5).
9. **Warranty terms are unconfirmed** for all three brands on air-to-air
   systems. The app shows no warranty years anywhere until you set them, and
   the catalogue's own **Warranty** notes (research, "NOT confirmed") never
   reach a family: the handover pack states the warranty wording frozen on
   their accepted proposal.
9a. **Manufacturer minimums are modelled only where the catalogue has them**
   (§K47; was "aren't modelled"). The design checks each run against the
   outdoor unit's minimum and maximum, and a multi-split's total, longest
   branch, fewest indoor units, least connected capacity and the height
   between indoor units; outside a limit on record blocks approval with the
   figures, a limit not on record is a CHECK, never a pass, and the engine
   never suggests a multi-split outside one. The install day checks each
   room's as-built run and the system's total against the same figures.
   But: *22 of the 40 researched outdoor units carry one or more of these
   limits, each from its own research notes* (Panasonic: 3 m minimum, and
   the multi-splits' totals, branches and two-room minimum; Daikin: 1.5 m on
   three singles, the MXM branches, totals and 7.5 m between indoor units;
   Mitsubishi MXZ: branches and totals). Every other figure is blank: the
   Mitsubishi singles and most Daikin singles have no minimum on record, no
   Panasonic or Mitsubishi multi has a height between indoor units, and no
   unit has a minimum connected capacity of its own (the compatibility
   rules' figures still apply). Nothing was read from a manual here (the
   manufacturers' hosts were unreachable): these are search-engine extracts.
   Still not modelled: a height limit that depends on whether the outdoor
   unit is above or below (Mitsubishi MXZ: 15 m, 10 m if it's higher; the
   survey records the height without the direction, so the design uses the
   15 m), and a total that depends on the indoor units (Daikin 3MXM52: 30 m
   with floor units). *Instead:* the technical lead reads every CHECK in the
   manual and fills the blanks in the catalogue (**Catalogue** → the item →
   the limits fields, or a CSV), and the crew lays any excess rather than
   cutting a run short.
9b. **R32 room size needs each outdoor unit's factory charge.** Above 1.84 kg
   in one system, every room it serves needs a minimum floor area (IEC
   60335-2-40 Annex GG formula; the manual's own table can be stricter, and
   the technical lead checks it). 15 researched outdoor units, mostly
   Mitsubishi, have no factory charge on record: a multi-split on one can't
   be approved, and the engine won't suggest it, until it's added from the
   nameplate or manual (START-HERE step 9). Indoor units without a height
   are taken as wall units at 1.8 m; a floor or ceiling unit needs its
   height set.

9c. **Multi-split reducers aren't modelled.** The catalogue has no port
   sizes for multi-split outdoor units, so the design's bill of materials
   and the kit never add a reducer, the job pack's flare heads are the
   indoor units' sizes only, and the runsheet records one torque reading per
   line (the field flares), not the reducer's joint. The flares step tells
   the crew to tighten a reducer's nuts as the manual says. *Instead:* the
   technical lead reads the outdoor unit's port and reducer table in the
   manual, adds any reducers to the purchase order, and checks them on the
   day.
9d. **The weighed charge is checked against the as-built length** (§K49;
   was "isn't compared"). The charge step works out max(0, as-built length −
   pre-charged length) × g/m from the length the engineer types, per outdoor
   unit, shows it next to the weighed figure, and flags a figure further off
   than the job's tolerance (10% or 50 g, whichever is larger, unless the
   technical lead sets the job's own) for the technical lead's sign-off with
   a reason. But: *a job already started before this change keeps its old
   charge step*, without the check; a model with no pre-charged length or
   charge rate in the catalogue has no expected figure (the step says the
   rate is missing, and the design can't be approved without it); the
   10%/50 g tolerance is the company's own default, not a manufacturer
   figure; and most catalogue charge rates are search-engine extracts until
   the technical lead verifies the item. *Instead:* on an older job, check
   the weighed figure against the formula before signing; verify each
   outdoor unit's pre-charged length and g/m against its manual.
9e. **The electrics design is a starting point, not the circuit design.**
   The breaker comes from the manufacturer (or a labelled rule of thumb)
   and the cable from the breaker alone; nothing works out maximum demand,
   the cable's rating for its route (insulation, the outside section) or
   voltage drop, picks the RCD type, or puts armoured cable in the bill of
   materials for an outside run, and the survey doesn't record the cut-out
   rating, a looped service or existing large loads. The design's check
   says so, and the runsheet asks the electrician to size it. *Instead:* the
   electrician designs the circuit and writes the supply check and the
   network operator's route on the checklist item **Supply capacity and the
   network operator (DNO)** before the booking; price any armoured cable or
   board work as a cost line.
9f. **Access at height: the survey refuses a ladder above the limit**
   (§K49; was "the surveyor's and the technical lead's call"). The survey
   records each outdoor position's height to the bracket; above the ladder
   limit (2.5 m, **Settings → Safety**) only a tower, podium steps, a
   scaffold or a MEWP finishes it; the hire is a cost line on the proposal
   (from the catalogue, else Settings, else unpriced, which holds the
   proposal until a price is typed); it reaches the RAMS, the bracket step,
   the job card and the tools list; and an outdoor unit over 25 kg in the
   catalogue is a two-person lift on the crew's day. But: *the limits are
   the company's, not the law's*. The Work at Height Regulations 2005 set
   no height for a ladder (it's a risk assessment: low risk, short
   duration), and HSE's ladder guidance (about 30 minutes, light work, a
   load over 10 kg needing a manual handling assessment) and its 25 kg
   guideline lifting weight were read through reproductions and extracts,
   not hse.gov.uk or legislation.gov.uk (unreachable from here): to verify.
   The app doesn't check who is on the crew for the lift (it says two; the
   booking doesn't count heads), work on a flat roof (edge protection) or
   at a balcony, or a ladder for other tasks (a core hole drilled from
   outside). 37 of the 40 researched outdoor units have a weight in the
   catalogue (32 of them over 25 kg; search-engine extracts); one without a
   weight raises no lift flag. A survey started before this change is judged at 2.5 m. *Instead:* the
   technical lead plans the rest on the **Working at height plan** item,
   and the office books two people when the job card says so.
9g. **Flats in blocks get no block questions.** The survey doesn't ask the
   block's height or storeys, its common parts or whether a pipe crosses a
   compartment wall or floor, and there's no fire-stopping photo for such a
   crossing. *Instead:* for any flat, the admin confirms the route with
   building control on **Building Regulations route for the heat pump** (a
   full plans application rather than a building notice in most blocks; the
   Building Safety Regulator's approval in a higher-risk building outside a
   competent person scheme), and the crew photographs the sleeve and its
   fire-stopping in the core-drilling step.

## The field app

10. **No native app.** It's a website on the phone: use it in Safari or
    Chrome, or add it to the Home Screen from `/field` (the icon opens the
    field app). The Home Screen app has its own sign-in, apart from the
    browser's, and a sign-in link always opens the browser, so sign in there
    with the 6-digit code from the sign-in email (field guide §1).
    Staff sign-ins renew as they're used (30 days at a time) but end 90
    days after signing in, whatever happens: **Me** says when, and the
    latest it can go on to. A phone left unused for 30 days is signed out,
    and a sign-in from before renewals arrived doesn't renew (sign in
    again once). A photo refused because the sign-in ran out waits and
    sends by itself once you're signed in again.
11. **Offline is a queue, not full offline.** Work done without signal
    (evidence, photos, survey answers, drawings) is saved on the phone and
    sent when signal returns, with a visible count. But:
    - open the job while you have signal (the page itself isn't stored on
      the phone);
    - starting and ending a day, the on-my-way text, commissioning sign-off
      and handover sign-off need signal, because the server checks them;
    - anything waiting lives in that phone's browser: clearing its data or
      using a private tab before it sends loses it. If the phone's storage
      refuses a capture (Safari dropping it, storage full), it's only in that
      page: the badge says **Keep open · N waiting** and the capture says
      so, so keep the page open until it syncs;
    - captures wait for the person who made them: one still waiting when its
      author signs out sends only when they sign in on that phone again,
      never under the next person's name;
    - commissioning can't be signed while anything for that job is still on
      the signer's phone, or over a reading that reached the server after
      the screen loaded (reload and check, then sign);
    - refrigerant (F-gas) and electrical (Part P) steps are checked against
      the certificate on file on the day they reach the office, not the time
      the phone says: a reading taken offline the day before a certificate
      ran out and sent after it is refused until the office adds the renewed
      certificate (the phone says so). Keep certificates renewed ahead of
      their expiry.
12. **No live location.** "On my way" sends the arrival time the installer
    picks; nothing tracks the van.
13. **Barcode reading works on Android only.** In Chrome on Android a serial
    number can be read from a photo of its label; on iPhones (Safari) it has
    to be typed, with the label photographed as evidence.

13a. **The leak check records the method, not the instrument's
    calibration.** The release step asks for the electronic detector's make
    and model and the pressure at the joints; the app can't check the
    detector's sensitivity or calibration. *Instead:* keep the detector's
    certificate with the F-gas records.

## Planning and scheduling

14. **One crew at a time is assumed.** The booking page warns when a person
    is already booked on another job those days, and surveyors are never
    double-booked, but nothing plans work across several crews. The pilot
    cadence is one install a week.
15. **The older planning screens** (`/ops/schedule` and `/ops/procurement`,
    not in the menu) estimate materials by rule of thumb. Real orders come
    from each project's **Kit** page, built from the approved design.
16. **Supplier lead time is a default** (5 working days, with 2 days'
    buffer before the install). There's no link to any supplier's system:
    you place orders by phone or on their website and record each step.
17. **Daily jobs run once a day**, at 16:00 UTC (4pm in winter, 5pm in
    summer). A message that fails is retried on the next run, or straight
    away with **Retry** on the Messages page. **Run daily jobs now** runs them
    on demand.
18. **The change-of-season email is calendar-based** (1 October, 1 June),
    not weather-based.

## Documents and money

19. **Documents are web pages.** Proposals, contracts, invoices, receipts,
    certificates and the handover pack open as pages; "PDF" means the
    browser's **Print → Save as PDF**. Emails carry the content and a link,
    not PDF attachments, and booking emails don't attach calendar invites.
20. **No automatic charging.** No saved cards, direct debits or recurring
    billing. You issue each invoice; bank transfers are recorded by hand once
    seen; card payments only through Stripe, if you set it up. A service-plan
    offer is never charged automatically.
21. **No accounting-software link** (Xero, QuickBooks). *For the
    accountant:* **Money: for the accountant** (`/ops/money`, admins only)
    downloads CSVs of every invoice and credit note, every payment and
    refund, and a summary that reconciles them, for any dates (admin guide
    §4); importing them into accounting software is by hand. "Owed at the
    end date" rebuilds that day from the records: an invoice voided before
    this change (when cancellations didn't stamp the time) counts as void
    on every date. The Pilots page CSV is pilot metrics, not an accounting
    record.
22. **Documents go by email only.** The proposal, contract confirmation and
    cancellation form are sent by email, and only once the family has agreed
    to that (the law's default is paper). There's no paper route: no way to
    record a proposal or contract handed over or posted, or an acceptance
    signed on paper. Nothing on their page, the terms or the field app
    promises paper. *Instead:* if a family would rather not use email, call
    them and talk it through; if they still want paper, tell them honestly
    and close the project (admin guide §3.2).
23. **Payments are never deleted.** Mistakes are corrected with a refund or a
    credit note, so the history stays true. Recording a refund doesn't
    email the family by itself (their page shows the invoice as refunded):
    tell them it's on its way, or send the receipt from **Messages**.
    - *More than is owed arrived* (a second transfer, a family paying the
      gross figure): tick **More than is owed arrived** on **Record a payment
      you've seen** (also on a paid invoice) and record it all; the extra is
      credit on their account, the team is alerted, and **Record a refund**
      on that invoice pays it back with no credit note.
    - *A card refund that Stripe reports as failed after it was recorded*
      (rare: an expired card, a closed account): the app marks the refund
      failed (kept, never deleted), the invoice reads as paid again, and the
      family is in credit by that amount on the money page (owed back); the
      credit note that went with it stays (they still don't owe it). An
      urgent alert says what to do: tell them, then refund again, in Stripe
      or by bank transfer recorded on the money page. It needs the
      `refund.failed` and `refund.updated` webhook events (going-live
      step 3); an endpoint set up before this change doesn't send them.
    - *A cancellation after work began at the family's request* inside the
      period: the office records the charge for that work on the money page
      (CCR reg 36(4); admin guide §5) and the app invoices it, holds what
      they paid against it and works out the refund or what's left to pay.
      The figure itself is yours to work out (a fair share of the price for
      what was done); nothing checks it beyond "more than zero and no more
      than the contract", so take advice if it's disputed (solicitor
      question 2 in `docs/research/uk-consumer-legal.md`). One charge per
      cancellation: to bring it down, **Reduce the charge** on the money
      page (a credit note against it); there's no way to raise it. Goods aren't part of
      it: the app makes no deduction for the equipment (reg 34(9)-(10)
      would need advice first). The unpaid part of a part-paid invoice is
      credited when the cancellation is recorded.
    - *A change over £42 agreed during the install* is treated as a contract
      of its own until a solicitor says otherwise (approvals item 7a): the
      family can cancel it within 14 days of agreeing, and the crew only
      starts it inside those days once the family has asked in writing (the
      office records their reply on the Issues page). No reply means the
      extra work waits for the end of the 14 days: book a return visit.
      Nothing stops a crew physically doing the work early; the field card
      says **don't start it** until then.
    - *Parking*: the prep list asks the family for parking information; a
      permit or a suspended bay is ours to arrange and pay for unless the
      proposal lists it (**Add a cost** → "Parking permit"), because the
      pre-contract information says there are no other costs.
    - *The 0% VAT rate for energy-saving materials* can't be put on a
      proposal issued after 31 March 2027; a job that straddles the date
      (issued before, installed after) goes to the accountant (approvals
      item 11).

23a. **Paperwork after handover is partly by hand.**
    - *The heat pump's own Building Regulations certificate* is tracked on
      its checklist item (the file and number go there as evidence) and
      shown on the family's page and in the pack; it isn't a customer
      document of its own, and the weekly overdue alert covers only the
      electrical certificate. *Instead:* email it to the family when it
      comes, attach it to the checklist item, and check that item 30 days
      after completion.
    - *Warranty terms per brand aren't stored.* The registration date the
      app keeps is the pack's (completion plus 90 days for Daikin, 30 for
      the rest), counted from completion, not commissioning, and the
      brands' own deadlines and owner steps weren't verified (approvals
      item 20). The team is alerted 14 and 7 days ahead, on the day, and
      weekly while it's late. *Instead:* put each brand's real deadline and
      conditions in **Settings → Warranty** before quoting.
    - *The yearly service reminder goes once* (about 30 days before the
      first service), and services aren't recorded. A warranty that needs
      a yearly service can lapse from year 2. *Instead:* put the service
      condition in the warranty wording in Settings, so it's in the
      contract and the pack, and diary each household's later services.

## Customers and messages

24. **Texts are one-way.** The sender name `DangItsHot` can't receive
    replies; every text gives your phone number instead. Until Twilio is set
    up, texts are recorded but not sent (families still get every email).
25. **Customers sign in by email only**: the link, or the 6-digit code in
    the same sign-in email (15 minutes, the newest email's only; links in
    our other emails carry no code). No passwords; one email
    address is one customer. A family sharing a home with two email
    addresses uses the one on the project (change it on the project to move
    access). Removing the email takes the project away from whoever owned
    it at once: until a new address is typed, only the office can open the
    project, and nothing is emailed; anyone already signed in with it loses
    the project too. After a correction, messages still
    waiting (and **Retry** / **Send again**) go to the new address with the
    wording they were written with; the old address never gets them again.
    There's no bounce tracking: an email the provider accepted reads as
    **Sent** even if the address was mistyped, so check the address before
    issuing a proposal. A proposal email that went to an address you've
    since corrected no longer counts as their pre-contract information
    (they can't accept until it's sent again to the new one).
26. **No WhatsApp or live chat.** Families reply by email or phone you.
27. **Messages about an appointment are never sent late.** An on-my-way
    text that couldn't go within 45 minutes (or by the arrival time it
    gives), a survey or install reminder once it has started, and a booking
    confirmation once it's over are marked **Skipped** with the reason,
    never sent by the daily retries or **Retry**; none goes for a closed or
    cancelled project. If one was skipped, phone the family if it matters.
28. **An email Resend doesn't answer within 10 seconds counts as failed**
    and is tried again by the daily jobs (or **Retry**). If Resend did take
    it but answered late, the family can get it twice.
29. **Emails anyone can trigger from the website have a daily budget**, so a
    script can't use up the email plan's quota (Resend Free: 100 a day,
    shared with your own proposals, invoices and alerts). The quote form's
    two emails (the family's price, your lead alert) and the sign-in link a
    new project sends share 30 a day (12 an hour); sign-in links asked for
    on `/portal` or a project page have 25 a day (10 an hour); reminders to
    unfinished quotes have 10 a day. Days are
    London days. Over it, nothing more of that kind is sent until the next
    hour or day: quotes still save and show under **Quotes**, a family
    can ask for a link again later, and a reminder waits for the next
    morning's run (inside its 7 days). Emails you send from the office are
    never held back by it. If real leads ever get near it, move to a paid
    Resend plan and raise the numbers in `lib/email-budget.ts`.
29a. **Website analytics record how far a visitor got through the quote**,
    never the postcode they typed, the price or their consent choices (the
    server drops them even if an old page sends them). Analytics from before
    this change may still hold postcodes and prices in `analytics_events`;
    delete those rows in Supabase if you want them gone.
30. **Service-level promises (credits for missed dates) are switched off**
    until they're worked out; the website makes no such promise.
31. **No finance offers** until an FCA-authorised lender or broker is in
    place.

31a. **Planning, consent and site safety: what the app enforces and what it
    doesn't.**
    - *Planning*: the technical lead's outcome is a recorded choice, and
      "consent needed" (or a listed building on record) holds install day 1
      until the council's decision notice is attached (§K48). The app
      doesn't track the application itself (when it went in, the council's
      decision period, conditions to discharge). *Instead:* note the
      application on the planning consent item, and check its conditions
      against the install before approving it.
    - *Leasehold and rented homes*: the day-1 gate rests on the survey's
      tenure. The quote form only asks "own or rent", so a leaseholder
      learns about the freeholder's consent at the survey, not from the
      online price. *Instead:* the surveyor records the tenure carefully;
      tell a leaseholder about the consent at the survey.
    - *CDM 2015*: the RAMS item asks for the construction phase plan's
      content (site rules, welfare, induction, coordination), but nothing
      records who is principal contractor and principal designer, and the
      handover pack has no health and safety file for a job with a
      subcontracted electrician. *Instead:* write both into the RAMS, and
      add the hidden pipe and cable routes, the R32 note and the isolators
      to the pack's notes for those jobs.
    - *Asbestos awareness*: the booking warns (doesn't block) when a pre-2000
      home's crew has no current asbestos awareness training on file, and
      nothing checks the surveyor's. *Instead:* add the training to each
      person's staff record (approvals item 4).

## Legal text

32. **The terms (`pilot-draft-2`) and the cancellation wording haven't been
    reviewed by a solicitor.** The model cancellation form was
    reconstructed from research, not copied from the official PDF, and the
    instructions for a change agreed during the install are our own
    completion of it. `/ops/launch` stays amber until it's reviewed and
    ticked in Settings.

## Running the site

33. **No error-alert service** (such as Sentry) is connected. Errors are in
    Vercel's logs; the daily GitHub health check and `/api/health` catch a
    broken or missing database.
34. **Database backups don't include photo files** (Supabase backs up the
    database only). The app never deletes customer photos. A restore puts
    the whole database back to that day: see admin guide §11.
35. **No one-click export or deletion of a person's data.** A
    data-protection request is answered from the project page, their
    documents, the Messages log and their quote, printed to PDF; deletion
    is a manual step in Supabase, only after legal advice, because deleting
    a project deletes its invoices and payments too (admin guide §12).
36. **Photos are the full-size originals.** Phones upload each photo at up
    to 2048 px; there are no separate thumbnail files. The end-of-day picker
    draws only the newest 24 (with **Show more**) and loads each only as it
    scrolls into view. A photo's link stays the same for up to an hour on
    each server, so pages that refresh (the family's page checks every two
    minutes) reuse what the browser already downloaded; another server, or
    the next hour, can make the browser fetch it once more.
37. **Roles are fixed** (admin, technical lead, surveyor, installer,
    electrician, plus "subcontractor"); there's no screen to customise what
    each can do. Installers and the electrician see the job in the field app
    but, like subcontractors, never the family's own pages (prices, contract,
    invoices); the commissioning certificate and handover pack open from
    the job. Use **Customer view** from the office to see what the family
    sees.
38. **The phone video-walkthrough app** (`apps/mobile`) isn't part of the
    pilots and its endpoints are off on the live site. It's a scaffold that
    has never been released: it now sends the quote consents (in the web
    funnel's words and shape) and each photo's type, as the API requires,
    and it type-checks, but nobody has run it against the API. *Before any
    release:* test it end to end against a deployment (a quote saved with
    its consents, photos uploaded, the video endpoints switched on).
39. **Admin break-glass relies on its password.** Attempts are slowed per
    network (5 a quarter hour) and every failure is logged, but there's no
    site-wide cap any more: one would let a stranger lock you out on launch
    day. So `OPS_PASSWORD` must be long and random (`openssl rand -base64
    24`), and once email sign-in works you can remove it in Vercel.
40. **Two dependency warnings remain** in `pnpm audit` after the Next.js
    15.5.28 update, both inside Next itself and neither reachable here: its
    bundled PostCSS (only ever runs on our own stylesheets, at build time)
    and `sharp` (only for Next's image optimiser, which the app doesn't use;
    Vercel serves images itself). They go when Next ships newer copies.
41. **Website analytics keep at most 20,000 events a London day**, each a
    few hundred bytes (a beacon over 4 KB, or with more than 20 facts, is
    refused), so nobody can fill the database through it. Past that,
    page views for the rest of the day aren't counted.
42. **An unfinished quote gets one reminder only if its owner agreed at the
    time.** Under the email on the quote form's first step is **Email me one
    reminder if I don't finish**, ticked unless they untick it. Only those
    left ticked get the reminder (once, a day to 7 days later, at most 10 a
    day); the email says why it came and how to have the quote deleted.
    Quotes started before this box existed are never reminded, by the daily
    job or from the **Unfinished** tab. Nothing checks that an address
    typed there is real, so a few reminders may bounce. *If someone asks
    for their unfinished quote to be deleted:* see admin guide §12.
43. **Projects from the old site start again at the survey.** The old site's
    "final quote" was the instant price, accepted with a click, and it told
    families that committed them to nothing; no proposal, contract or
    cancellation information was ever sent. So an old project is not a
    contract here: it shows on the Board at **Price**, the old site's
    acceptance, site visit and install date are in an internal note in its
    history (**Moved from the old system: …**), and you survey, design and
    send a proposal as for any household. Call anyone whose note gives an
    old install date. Only a project where work really went ahead on the
    old site (kit sent or the install finished) keeps its old contract.
44. **Two people editing the same staff record or catalogue item:** the
    second save from a page opened before the first is refused ("Someone
    saved this … since you opened it"), never written over it; reload and
    make the change again. **Retire** / **Restore** is its own button: saving
    the form never brings a retired item back into use.
