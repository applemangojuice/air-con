# Known limitations

An honest list of what the pilot platform doesn't do, or does only
partly, as of 20 October 2026. None of these stops the four pilots; each
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
   check at the neighbour's window (MCS 020) can't run fully. The technical
   lead completes it from the datasheet.
6. **Room sizing is a rule of thumb**, labelled "for review, not a heat-loss
   calculation". The technical lead picks every size.
7. **Commissioning targets are set by the technical lead, per job.** No
   manufacturer test pressure, vacuum, decay, torque or drain-fall figure
   was verified, so the app shows the unverified candidates as hints, records
   every reading, and only judges readings once the technical lead sets the
   targets from the manual.
8. **Model codes and generations need confirming** with the UK distributor
   before ordering (for example Daikin FTXM-A vs FTXM-R, Panasonic CKE vs
   ZKE, Mitsubishi MXZ VF3/VF4/VF5).
9. **Warranty terms are unconfirmed** for all three brands on air-to-air
   systems. The app shows no warranty years anywhere until you set them.

## The field app

10. **No native app.** It's a website on the phone: use it in Safari or
    Chrome, with a bookmark to `/field`. A Home Screen icon opens the public
    home page, and on an iPhone it doesn't share Safari's sign-in (sign-in
    links always open in the browser), so don't use one for the field app.
    Staff sign-ins last a fixed 30 days and aren't renewed as you use them:
    **Me** says when this phone's runs out (in amber in the last 3 days);
    sign out and in again with signal before a job day. A photo refused
    because the sign-in ran out waits and sends by itself once you're
    signed in again.
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
21. **No accounting-software link** (Xero, QuickBooks), and no export of
    every invoice and payment across projects. The Pilots page downloads a
    CSV of pilot metrics (not an accounting record: a cancelled pilot
    counts only the money kept as revenue, with `cancelled` = yes). *For
    the accountant:* print each project's invoices, credit notes and
    receipts to PDF from its money page (four pilots, four pages).
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
      (rare): the refund and its credit note stay recorded and nothing in the
      app can reverse them. Don't refund again or record it by hand (both
      count it twice): ask the developer to reverse the two records in the
      database, then sort it out with the customer. The urgent alert says so.
    - *A cancellation after work began at the family's request* inside the
      period: nothing can be billed after a cancellation, so a proportionate
      charge for that work (CCR reg 36(4)) can't be invoiced in the app.
      Their page and the email no longer say "nothing more is due" in that
      case; keep any deduction by recording a partial refund with the reason
      (it stays on the deposit invoice), and for a charge above what they
      paid take advice and invoice it outside the app (solicitor question 2
      in `docs/research/uk-consumer-legal.md`). The unpaid part of a
      part-paid invoice is credited when the cancellation is recorded.
    - *The 0% VAT rate for energy-saving materials* can't be put on a
      proposal issued after 31 March 2027; a job that straddles the date
      (issued before, installed after) goes to the accountant (approvals
      item 11).

## Customers and messages

24. **Texts are one-way.** The sender name `DangItsHot` can't receive
    replies; every text gives your phone number instead. Until Twilio is set
    up, texts are recorded but not sent (families still get every email).
25. **Customers sign in by email link only.** No passwords; one email
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
30. **Service-level promises (credits for missed dates) are switched off**
    until they're worked out; the website makes no such promise.
31. **No finance offers** until an FCA-authorised lender or broker is in
    place.

## Legal text

32. **The terms (`pilot-draft-1`) and the cancellation wording haven't been
    reviewed by a solicitor.** The model cancellation form was
    reconstructed from research, not copied from the official PDF.
    `/ops/launch` stays amber until it's reviewed and ticked in Settings.

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
