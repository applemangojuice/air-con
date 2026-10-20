# Known limitations

An honest list of what the pilot platform doesn't do, or does only
partly, as of 19 October 2026. None of these stops the four pilots; each
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

10. **No native app.** It's a website on the phone. Add it to the home
    screen for an app-like icon.
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
    - rarely, a screen doesn't show the result of what you just did (seen
      once in testing, after publishing the handover pack): pull down to
      refresh, or open the job again;
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
21. **No accounting-software link** (Xero, QuickBooks). The Pilots page
    downloads a CSV.
22. **Payments are never deleted.** Mistakes are corrected with a refund or a
    credit note, so the history stays true. Recording a refund doesn't
    email the family by itself (their page shows the invoice as refunded):
    tell them it's on its way, or send the receipt from **Messages**.

## Customers and messages

23. **Texts are one-way.** The sender name `DangItsHot` can't receive
    replies; every text gives your phone number instead. Until Twilio is set
    up, texts are recorded but not sent (families still get every email).
24. **Customers sign in by email link only.** No passwords; one email
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
25. **No WhatsApp or live chat.** Families reply by email or phone you.
26. **Emails anyone can trigger from the website have a daily budget**, so a
    script can't use up the email plan's quota (Resend Free: 100 a day,
    shared with your own proposals, invoices and alerts). The quote form's
    two emails (the family's price, your lead alert) and the sign-in link a
    new project sends share 30 a day (12 an hour); sign-in links asked for
    on `/portal` or a project page have 25 a day (10 an hour). Days are
    London days. Over it, nothing more of that kind is sent until the next
    hour or day: quotes still save and show under **Quotes**, and a family
    can ask for a link again later. Emails you send from the office are
    never held back by it. If real leads ever get near it, move to a paid
    Resend plan and raise the numbers in `lib/email-budget.ts`.
27. **Service-level promises (credits for missed dates) are switched off**
    until they're worked out; the website makes no such promise.
28. **No finance offers** until an FCA-authorised lender or broker is in
    place.

## Legal text

29. **The terms (`pilot-draft-1`) and the cancellation wording haven't been
    reviewed by a solicitor.** The model cancellation form was
    reconstructed from research, not copied from the official PDF.
    `/ops/launch` stays amber until it's reviewed and ticked in Settings.

## Running the site

30. **No error-alert service** (such as Sentry) is connected. Errors are in
    Vercel's logs; the daily GitHub health check and `/api/health` catch a
    broken or missing database.
31. **Database backups don't include photo files** (Supabase backs up the
    database only). The app never deletes customer photos.
32. **Roles are fixed** (admin, technical lead, surveyor, installer,
    electrician, plus "subcontractor"); there's no screen to customise what
    each can do. Installers and the electrician see the job in the field app
    but, like subcontractors, never the family's own pages (prices, contract,
    invoices); the commissioning certificate and handover pack open from
    the job. Use **Customer view** from the office to see what the family
    sees.
33. **The phone video-walkthrough app** (`apps/mobile`) isn't part of the
    pilots and its endpoints are off on the live site.
34. **Admin break-glass relies on its password.** Attempts are slowed per
    network (5 a quarter hour) and every failure is logged, but there's no
    site-wide cap any more: one would let a stranger lock you out on launch
    day. So `OPS_PASSWORD` must be long and random (`openssl rand -base64
    24`), and once email sign-in works you can remove it in Vercel.
35. **Two dependency warnings remain** in `pnpm audit` after the Next.js
    15.5.28 update, both inside Next itself and neither reachable here: its
    bundled PostCSS (only ever runs on our own stylesheets, at build time)
    and `sharp` (only for Next's image optimiser, which the app doesn't use;
    Vercel serves images itself). They go when Next ships newer copies.
36. **Website analytics keep at most 20,000 events a London day**, each a
    few hundred bytes (a beacon over 4 KB, or with more than 20 facts, is
    refused), so nobody can fill the database through it. Past that,
    page views for the rest of the day aren't counted.
