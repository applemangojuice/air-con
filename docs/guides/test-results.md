# Test results

The latest real results of every automatic check, run on the morning of
**20 October 2026** on branch `claude/pilot-ops` at commit `1f8f0da`: the
fixes from round 7 of the pre-launch review [below](#what-round-7-found),
on top of round 6's (`ed1732e`, [below](#what-round-6-found)), round 5's
(`a04cc53`, [below](#what-round-5-found)), the handover fix (`454c8d1`,
[below](#the-handover-flake-fixed)), the go-live pack, the Supabase
compatibility work and the fixes from the final pre-launch review and
rounds 3 and 4. Everything was run **twice, start to finish, and passed
both times**, on both databases. Every person, home and price the browser
walks use is fictional and labelled DEMO.

**Summary: everything passed, on both databases.** 958 unit tests, the type
check (the iOS scaffold included), the production build (Next.js 15.5.28),
every database migration check (110 assertions) and the upgrade file
check; then the browser walks on **both** backends: on the local file
database, 204 end-to-end pilot checks and 24 quote-form checks; on a
Supabase-shaped stack (Postgres 16, PostgREST and the Storage API, as a real
Supabase project serves them, with the database's default grants as a
project created today has them), the same 204 and 24, the property book
importers over 3,000 homes, and 439 checks across 284 screens with no
statement refused by the database.

| Check | Command | Result | Round 1 (UTC, 20 Oct) | Round 2 (UTC, 20 Oct) |
| --- | --- | --- | --- | --- |
| Type check (domain, web, mobile) | `pnpm -r typecheck` | **Pass** (3 of 3 projects) | 10:56 | 11:12 |
| Domain unit tests | `pnpm test` | **467 of 467 pass**, 0 fail (29 test files) | 10:56 to 10:57 | 11:12 |
| Web unit tests | `pnpm test` | **491 of 491 pass**, 0 fail (53 test files) | 10:56 to 10:57 | 11:12 |
| Production build | `pnpm --filter @aircon/web build` | **Pass**: Next.js 15.5.28, compiled, 34 of 34 static pages generated | 10:57 to 10:58 | 11:12 to 11:13 |
| Database migrations | `bash supabase/tests/run-migrations.sh` | **Pass**: 15 migrations and the pilot upgrade bundle; the local backend's schema matches; 110 sanity assertions | 10:58 | 11:13 |
| Upgrade file is current | `bash supabase/build-pilot-upgrade.sh --check` | **Pass**: `pilot-upgrade.sql` is current (0010 to 0014) | 10:58 | 11:13 |
| Pilot walk, **local file database** | `node scripts/e2e-pilot.mjs` | **204 of 204 pass** | 10:58 to 11:02 | 11:13 to 11:18 |
| Quote form walk, **local file database** | `node scripts/e2e-funnel.mjs` | **24 of 24 pass** | 11:02 to 11:03 | 11:18 |
| Pilot walk, **Supabase-shaped** | `bash supabase/tests/compat/run-compat-e2e.sh` | **204 of 204 pass** | 11:03 to 11:12 | 11:18 to 11:27 |
| Quote form walk, **Supabase-shaped** | (same run) | **24 of 24 pass** | (same run) | (same run) |
| Property book import, **Supabase-shaped** | (same run) | **Pass**: 3,000 homes, 900 in a conservation area, 3,000 classified (three times Max Rows) | (same run) | (same run) |
| Every screen, **Supabase-shaped** | (same run) | **439 of 439 pass**: 284 pages over 212 routes, 141 requests with ids that aren't there, a NUL in the quote form, 4 CSV exports, 4 daily jobs | (same run) | (same run) |
| Database and app logs, **Supabase-shaped** | (same run) | **Clean**: no statement refused by Postgres, no PostgREST or Storage error in the app's log | (same run) | (same run) |

Both rounds ran on commit `1f8f0da` (after it only documents changed:
architecture §K44 and this file), each from a fresh build and fresh, empty
data, straight through, on ports 3790 to 3793. The pilot walk has four more
checks than before: in phase E the option's planning or noise warning, the
issue panel's line asking for the note, and the suggested note (an
application "may be needed", never "isn't needed"); in phase F the note on
the family's proposal. Round 7 changes nothing in the handover, so the
30-handover loops were not repeated: their results (30 of 30 on each
database, the Supabase-shaped one slowed down) are with the handover fix
[below](#the-handover-flake-fixed). Before the two rounds, two trial passes
of the local walks: the first stopped at phase E because the walk didn't yet
add the planning note the new rule asks for (the product refused the issue
as designed; the walk was updated, not the rule), the second passed 204 and
24. Nothing flaked: every walk passed first time in both rounds.

The kept-drawing fix was also checked by hand on a production build (file
backend, Pixel 7 emulation) with the reviewer's own script: a drawing whose
save failed on a dropped connection reached the server before the survey
submitted; and with the connection kept bad until the check screen, the
screen said "1 drawing not saved yet", **Submit survey** stayed disabled,
**Save it now** said it still wasn't saved, and once the signal returned it
saved and the survey submitted with the drawing on the photo.

Set-up for the local walks: a production build (`next start`) on the local
file database (which enforces the same schema Postgres does), a fresh
empty data folder each round, demo sign-in on, a `SESSION_SECRET` over 40
characters, headless Chromium 1194. For the Supabase-shaped walks: the same
build with **no** `DATA_BACKEND`, talking to the stack only through
supabase-js with the service-role key, as a demo deployment
(`ALLOW_DEMO_LOGIN=1 DEMO_DEPLOYMENT=1`), the route walk signing in by
**Admin break-glass**. The handover loops walk a new pilot to phase I
(commissioning signed) at full speed, then put the job back to that point
before each round (the project row only, written directly: test-only).
Node 22.22.0, pnpm 10.12.1, PostgreSQL 16.15, PostgREST 12.2.3.

## What round 7 found

A seventh pass of the pre-launch review found three problems with money,
legal promises and survey evidence that reach real families, six smaller
ones worth fixing before the first of them, and a list of medium ones. All
are fixed or written up (architecture §K44), each with tests that fail
without the fix:

- **With credit on the account, the invoice asked for too much.** A
  goodwill credit note on its own, or a variation that takes money off billed
  on its own, is credit on the family's account, and the pay page and card
  checkout took it off; but the invoice document said "To pay £6,113.20"
  beside the bank details, the email's subject asked for the same, a bank
  transfer of that amount couldn't be recorded ("more than is left"), and the
  receipt then said £200 was still owed and showed our own `manual:` id as
  the payment reference. Now the invoice itself prints "Less: credit on your
  account (credit note DIH-0001)" and "To pay" the figure the pay page asks
  for, the email says the same, the receipt works out what's left the same
  way and prints the family's own reference, and money that really arrived
  above what was owed can be recorded (tick **More than is owed arrived**):
  the extra is credit on their account, the team is told, and a refund pays
  it back with no credit note. (New tests on the real money module: the
  goodwill credit, then the balance: document, email, a refused typo, the
  right payment and its receipt, a second transfer recorded and refunded.)
- **The pay page promised a refund after a late cancellation.** The email
  and their project page said "we'll be in touch in writing" when a
  cancellation arrived after the period, but the pay page said "anything
  you've paid is refunded by 3 Nov 2026". Now it follows the same rule
  ("We've received your cancellation … We'll be in touch in writing",
  no date, no refund). Nothing anywhere says "nothing more is due" when work
  began early at their request, the page carries the email's caveat about a
  deduction for that work, and once a refund is recorded it stops promising
  one. (New tests: the pay page's wording inside and after the period, and
  with early work; the hub after a partial refund.)
- **A drawing kept on the surveyor's phone could be left behind for good.**
  A drawing whose save failed on a weak signal (the phone still "online")
  was only retried on an `online` event or when an editor opened or closed,
  and the survey could be submitted with it still on the phone, after which
  nothing ever sent it: the design was done from a bare photo. Now kept
  drawings are retried every 30 seconds while any wait, when the page comes
  back into view and before the submit, and the check screen lists them
  ("1 drawing not saved yet", **Save it now**, open the photo) and holds the
  submit until they're saved, as it does for photos. (Checked on a production
  build in a Pixel 7 emulation with the reviewer's own script: the drawing
  reaches the server; with the signal kept bad to the check screen, the
  submit stays disabled, **Save it now** says it's still not saved, and once
  signal returns it saves and the survey submits with the drawing.)

The six smaller ones:

- **(a) The catalogue editor** couldn't save the two Daikin Perfera outdoor
  units after **Load researched catalogue** (a 71-character heating range,
  limit 60): free-text specs now take 200 characters, a test checks every
  researched item against the editor's own rules, a refusal names the field
  as the form labels it with the length and the limit, and the CSV import
  reads the day-first dates Excel and Google Sheets save (18/10/2026).
- **(b) A survey the family booked themselves had no surveyor** and almost
  nothing said so: every calendar entry now names who's on it or says **No
  surveyor** in amber, the day view lists visits nobody is down for, the
  project's **What's blocking** and the board say **Assign a surveyor**,
  **Today** and the morning email list **Surveys with no surveyor**, and the
  team gets one urgent alert on the working day before.
- **(c) The design's own planning and noise checks** (outdoor units allowed
  under permitted development, unit size, 42 dB(A) at the neighbour's
  window) reached nobody: they now sit beside the survey's answers on the
  compliance page, a new design version reopens the planning and noise items
  if they were signed off before it, a flagged option warns in the proposal
  builder, and the proposal can't issue until the office writes a note for
  the family (a suggested one says an application may be needed and what
  happens next) or records why it doesn't apply. Nothing concludes that
  planning is or isn't needed.
- **(d) Kit emails and the cancellation date**: kit held at our store or with
  the installer reads "has arrived with our team" (never "delivered") and
  says the period starts when it's brought to their home; on the day the
  period starts, the family gets one email (never a text) with the exact
  last day they can cancel, as the contract email promised.
- **(e) Replying to a team alert** reached our own inbox: every alert about a
  customer now says so and prints their phone and email.
- **(f) The iOS scaffold** now shows and sends the quote consents and each
  photo's type, as the API requires; it's a scaffold, never released
  (known limitations 38).

From the round's medium list, fixed: a stale staff or catalogue tab can no
longer undo a save (the second save is refused), and a catalogue save never
brings a retired item back; the unpaid part of a part-paid invoice is
credited when a contract is cancelled; overpayments can be recorded (above);
VAT on invoices follows the tax code (a 0% energy-saving invoice no longer
says "We aren't VAT registered"), an unregistered variation shows no VAT rows
and the 0% rate can't be offered after 31 March 2027; a cancelled pilot
counts only the money kept as revenue; a photo refused because the 30-day
sign-in ran out waits and sends after signing in, and **Me** says when it
runs out; the field guide no longer says to add the app to the Home Screen.
Written up with the workaround instead (known limitations 10, 21, 23, 44): a
card refund that Stripe reports as failed after it was recorded, a charge
for work done early before a cancellation, an export of every invoice for
the accountant, and fixed (not sliding) staff sign-ins.

## What round 6 found

A sixth pass of the pre-launch review found three problems, all with data
or emails that reach real people. All three are fixed in `ed1732e` (on top
of the work saved mid-run in `a8d991a`), each with tests that fail without
the fix (architecture §K43):

- **A household that clicked "accept" on the old site was stuck for good.**
  The old site issued a high-confidence quote's "final quote" automatically
  and let the family accept it with two clicks, saying it didn't tie them
  in. After the upgrade that became an accepted contract with a contract
  total, so the office could never save a design, record their documents
  agreement or issue a proposal ("The proposal is accepted. Changes now go
  through a variation."), and kit and the install could never go ahead
  either; the family's page showed a contract total for a contract nobody
  formed. Now an old project is a contract only if work really went ahead
  on the old site (kit sent or the install finished). Otherwise it starts
  at **Price** like any household: no proposal, an old site visit is a
  home survey still to book (it left nothing to design from), an old
  install date isn't a booking, and an internal note in its history says
  what the old site had (price, dates). An old *issued* final quote no
  longer shows "Review your proposal" with no proposal behind it. (New
  test: every old state before work went ahead, from "created" to "install
  booked", goes through the survey, the design, the documents agreement,
  a real proposal and acceptance; old projects where work went ahead keep
  their contract.) Known limitations 43; START-HERE step 3 says so.
- **The follow-ups scheduled on website quotes surfaced nowhere.** The
  console had lost the old "Due today" list, the only place a quote's
  **Next action** showed outside its own page. **Today** (`/ops`) now lists
  **Website leads due today** (due today or overdue, by London day,
  declined quotes left out, with "overdue since"), the morning email lists
  the same, and **Quote requests** has a **Next action** column with the
  due date, sortable soonest first; the CSV carries it. The morning
  routines (admin guide §2, the ops help page) include it. (New tests: the
  London-midnight cut-off across the clocks going back, the list and its
  count; the pilot walk sets a next action due today on its household's
  quote and finds it on **Today** and in the inbox.)
- **The unfinished-quote reminder went to anyone, unbudgeted.** Every
  draft with any email typed at step 1 got the reminder the next morning,
  up to 50 a day, outside the website's email budget: a script typing
  addresses could make us send 50 emails a day from our domain to
  strangers, and with the other two budgets, more than Resend Free's 100 a
  day the office's own proposals and invoices need. The email had no
  opt-out line, and someone with two drafts could get two "only" nudges.
  Now step 1 offers **Email me one reminder if I don't finish** under the
  email (ticked unless they untick it), the draft records the answer, and
  only drafts left ticked are reminded: once per address ever, never one
  that finished a quote, at most 10 a run, from a new reminder budget of
  10 a day (the website's three budgets total 65). The email says why it
  came and how to have the quote deleted. Older drafts are never reminded,
  and the **Unfinished** tab offers its pre-written email only where the
  box was left ticked. (New tests: the real daily job with 15 ticked
  drafts, an unticked one, an old one, a finished one and an
  already-reminded one sends 10, to ticked drafts only, each with the
  opt-out line; run again the same day it sends none and releases the
  other 5 for the next day. The quote-form walk checks the box is offered,
  ticked and can be unticked.) Known limitations 29 and 42.

## What round 5 found

A fifth pass of the pre-launch review found two problems, and the reviewers
evidenced six smaller ones worth fixing before real families. All eight are
fixed in `a04cc53` (on top of the interrupted work in `b93b36f`), each with
unit tests that fail without the fix (architecture §K42):

- **While a change waited for the family's OK, their page said "Nothing for
  you to do right now"**, at the top of the page and on **Your homes**,
  while the email and text said the change needed their OK before we went
  ahead. The next step now knows about the changes the office has sent:
  **Answer a change to your installation**, with which change and its price
  ("Change #2: … (+£120). We need your yes or no: nothing extra is done
  without your yes."), and its button opens the change to answer; **Your
  homes** says the same. It comes before anything else they could do,
  never on a closed project, and goes as soon as they've answered. (New
  tests in the domain and the hub; the pilot walk checks the card, the
  button, **Your homes** and the card once answered, at phase H.)
- **The consent box promised "otherwise we'll arrange paper copies"**, and
  so did the terms and the field screens, but no paper route exists: a
  family who left the box unticked waited for ever and was told the delay
  was ours. The pilot sends documents by email only, and now says so
  everywhere it's asked (the box, the terms, the survey screens and help,
  the proposal builder, the readiness gate), with what happens if they'd
  rather not: we get in touch. The survey email asks for the agreement when
  it's missing; a proposal past its date because it waits on their
  agreement says that, not sorry; and the daily late-proposal alert tells
  the office what it's waiting for and how to close it honestly, instead of
  "Send it". Their recorded wording is versioned (`docs-by-email/portal-2`;
  earlier agreements keep theirs). The gap is a known limitation (22).
  (New tests.)
- **Sending an email had no time limit**: a slow Resend could hold a
  request (a proposal issue, a booking) indefinitely. Resend now gets 10
  seconds, as Twilio does; no answer is a failed send, with the reason, that
  the daily jobs or **Retry** try again. (New tests with a Resend that never
  answers.)
- **A message about an appointment could arrive late**: a failed on-my-way
  text retried at the next daily run, or a reminder after the survey had
  started. On-my-way messages now expire 45 minutes after they're written
  (or at the arrival time they give, if later); survey and install
  reminders when the appointment starts; booking confirmations once it's
  over; and none goes for a closed or cancelled project. After that it's
  **Skipped** with the reason, never sent, by the daily retries or
  **Retry**. (New tests, including the clocks: a 10:00 survey in July is
  09:00 UTC.)
- **The end-of-day photo picker downloaded every photo of the day** at
  full size each time it opened. It now draws the newest 24 (any already
  picked stay), with **Show more photos**, as small fixed-size thumbnails
  that load only as they scroll into view, and reuses the links it had when
  it's opened again. (New tests.)
- **The family's page fetched every photo again every two minutes**,
  because each refresh signed new links. A photo's link is now the same
  for up to an hour (one expiry per hour, and the server reuses the links
  it handed out), so the browser shows its copy. (New tests: the same link
  twice, its expiry on the hour, at least an hour of life left.)
- **White text on the orange indoor-unit label failed contrast** (2.9:1).
  The label text is now whichever of white and dark ink contrasts more:
  every label colour reaches 4.5:1. (New test over every colour.)
- **No runbook for restoring a backup or answering a data-protection
  request.** The admin guide now has both (§11 and §12: what can be
  exported today, how to correct details, what must be kept, and why
  deleting a project row in Supabase is a last step after legal advice),
  linked from START-HERE's "If something goes wrong".

## The handover flake (fixed)

**What was seen.** Twice on the Supabase-shaped stack (once in the
compatibility run, once in round 2 of round 4's checks), the pilot walk
stopped at phase J: the crew phone published the handover pack (the server
answered 200 and the screen said "Published"), but the sign-off stayed
greyed out. On a real phone that's in front of the family, at the moment
they're asked to sign.

**Reproduced.** The compatibility gateway now has a test-only latency knob
(`GATEWAY_LATENCY_MS`, `GATEWAY_JITTER_MS`, or `POST /__compat/latency`
while it runs), and a loop repeats just the handover on one job
(`scripts/e2e-handover-loop.mjs`; `supabase/tests/compat/run-handover-loop.sh`
sets it all up), reading every page-refresh response as the page itself
reads it. On the build before the fix (`3f53dd5`), slowed down by 40 ms
plus up to 160 ms, **19 of 30** rounds passed; at 60 plus up to 240,
**20 of 30**. Every double tap (every third round) published the pack twice:
two versions, two emails. And once in each run the screen never moved on:
the refresh after the step arrived complete, with the pack (or the
sign-off) in it, and was never put on screen; a tap on a tab still worked.
When it did move on, the sign-off opened 5 to 9 seconds after the tap.

**Why.** The screen enabled the sign-off only when `router.refresh()` had
re-drawn the page from the server. On Next.js 15.5 an in-place refresh can
stall for good when its response streams in pieces, more often when a
second one overlaps it (the double tap's, or the one after a sync). The
proposal builder had met the same thing (it reloads the page instead).

**The fix** (architecture §K41). Nothing on a field screen waits for a
refresh any more: every step answers with what the screen needs (the job's
header, versioned so an older refresh can't take the screen back), and the
screen shows it at once; refreshes run in the background, one at a time.
Publishing carries the tap's own id, so a double tap or a retry is one pack
and one email; signing a signed handover or signed commissioning, and
starting a day already under way, answer with what's on record instead of
an error; with no reply, the phone says it may not have gone and that
trying again is safe. The same goes for commissioning (targets, reviews,
the signature), day start and end, and on my way. The family's portal
takes an answered change off "needs your answer" at once (and the same
answer again is accepted, not refused), and says when the page hasn't
caught up. Office forms (booking, payments, invoices, compliance and the
rest) hold their button and say so when a refresh never lands, so a payment
can't be recorded twice against a page that still shows it owed.

**Proof.** 11 new unit tests and new checks in the variation test: the
server answering a publish, a sign-off, commissioning, a day start and a
variation answer sent twice (each fails on the old code), and the header,
commissioning and portal overlays. The same loop on the fixed
build passed **30 of 30** at 60 plus up to 240 ms during the work, and in
both final rounds above **30 of 30 on each database**; double taps
published once. In 1 of the 120 final rounds (on the local file database,
so it isn't only Supabase's slower answers) and 1 of the 30 during the
work, the background refresh never landed within 10 seconds: those rounds
passed anyway, because nothing waits for it any more.

## What round 4 found

A fourth pass of the pre-launch review found nine more problems. All nine
are fixed in `4d9c16b`, each with unit tests that fail without the fix
(architecture §K40):

- **Issuing a proposal could email an older price than the one on the
  screen.** The builder works its prices out on today's catalogue and
  settings, but **Issue** sent the draft as last saved: after a supplier
  price or a labour rate changed, the family was emailed yesterday's
  figure (on a cost-plus option, hundreds of pounds less) and the
  minimum-margin check ran on yesterday's costs. Issuing now reprices
  every option exactly as a save does, the builder sends the figures it
  showed, and nothing is issued if they differ (it says what changed).
  Opening the builder after such a change saves today's figures straight
  away and says so. (New test: a £300 rise in a unit's cost after the
  draft was saved; issuing on the old figures is refused, issuing on
  today's sends today's price in the email and the frozen document, and a
  fixed price whose margin falls below the minimum on today's costs is
  refused. A browser check on the local build did the same through the
  catalogue and the builder: £7,820 on screen, £7,820 in the email.)
- **A typo in a family's name, address or postcode couldn't be put right**,
  although both guides said **Edit contact and access** fixes the name.
  It now has the name, the first line of the address and the postcode
  (checked like **New pilot**, never blank); the change is logged, the
  board and the Pilots page follow, and documents already issued keep the
  details they were issued with (the guides say so). (New tests.)
- **After a cancellation and its refund, the money page offered a new
  deposit invoice**, and one click emailed the family who had cancelled a
  fresh bill with bank details. Once a contract is cancelled nothing more
  can be invoiced (only refunds and credit notes); a deposit that was paid
  and then refunded never makes way for a fresh one; and the family's page
  shows the refunded invoice as **refunded**, not "due" on its old date.
  (New test on DEMO 3: cancel, refund the deposit, then every kind of
  invoice is refused and nothing is emailed.)
- **Correcting a wrong email after the proposal had gone let the family
  accept a contract whose pre-contract information they never got.** A
  new address on an issued proposal now clears the record that the
  information was delivered (it went to someone else), and acceptance
  also needs their agreement to documents at the new address. They can
  accept once they've agreed and the proposal email has gone to the new
  address (**Messages** → **Send again**); the guides say how. (New
  tests.)
- **A cancellation that arrived after the cancellation period still
  emailed a written promise of a full refund and collection.** Recording
  one now warns the office first; the family is told only that we've
  received it and will be in touch in writing; their page promises no
  refund; and a task to take advice replaces the refund and collection
  tasks. (New tests, including the London day deciding the period across
  the clocks going back on 25 October 2026: 23:30 BST on the last day is
  inside, 00:30 BST the next morning, still the 24th in UTC, is outside.)
- **After a cancellation, the family's page still showed the install as
  happening** ("Install, now, Mon 26 Oct", the day-by-day plan, the
  power-off warning) and aftercare as done. The page now says **Your
  contract is cancelled**, with when it reached us, the refund and its
  date and the collection (or, after the period, only that we'll be in
  touch); the stages that won't happen show **cancelled** with no date,
  their panels show the cancellation instead of plans, and the contract
  total reads cancelled. (New tests, and a browser check on the local
  build: no page errors.)
- **Removing a project's email didn't sign out the person who owned it**:
  a sign-in from before the change kept the household's page, photos and
  actions for up to 30 days. Access now follows the project as it stands,
  never the list saved in the sign-in. (New test, and a browser check: the
  old sign-in gets the sign-in page and a 404 for the photos.)
- **Anyone could use up the day's email quota in about a minute** by
  posting quotes with made-up addresses and starting projects from them,
  after which proposal, contract and sign-in emails failed until the next
  day. The emails anyone can trigger from the website now come from a
  shared daily budget, per London day and per hour, well under the email
  plan's 100 a day (known limitation 29); the office's own emails are
  never held back. (New tests, including the budget's day across the
  25-hour day the clocks go back.)
- **The website's analytics beacon stored anything it was sent**: one IP
  could write gigabytes a minute and fill the database. A beacon is now at
  most 4 KB of flat facts, the user agent is trimmed, at most 20,000
  events are kept a day, and quote and draft bodies are capped too.
  (New tests, and on the local build a 4 MB beacon is refused with 413
  and stores nothing.)

## What round 3 found

A third pass of the pre-launch review found nine more problems. All nine
are fixed in `9ef0a25` (and stayed fixed in `4d9c16b`), each with unit tests that fail without the fix
(architecture §K39):

- **Retrying a message after correcting a wrong email sent it to the old
  (wrong) address again**, and the corrected address could never get it.
  Customer messages now follow the project's contact when they're sent:
  after a correction, **Retry**, **Send again** and the daily retry send the
  same message to the new address (once per address) and never to the old
  one, which stops being retried; a removed address gets nothing. Sending
  the same message again for the new address works instead of saying
  "duplicate". The pre-contract information and contract confirmation only
  count when they reached the project's current email. START-HERE and the
  admin guide say so. (New tests: a failed invoice email to a typo, the
  address corrected, then Retry, the daily retry, a fresh send, and a
  removed address; a resend never reaches the typo.)
- **Removing a wrong email left its owner attached**: they could still sign
  in to the household's page and were still sent its sign-in links.
  Removing the email now detaches the project in the same save, and a
  project's sign-in link only goes to the project's own current email.
  (New test: the removed address loses the project at once, gets no link,
  and can't claim it back.)
- **A variation that takes money off, billed on its own, became a negative
  "invoice" nothing treated as credit**, so the balance billed the full
  price and the customer was overcharged by the reduction. It's now a credit
  note tied to the variation, which comes off what they pay; no invoice can
  have a negative total. (New tests: a −£40.50 variation billed before and
  after the balance; the customer is asked for exactly the agreed price.)
- **Issuing a proposal while a colleague's autosave landed** could email one
  set of prices while the customer accepted another, and lose the
  colleague's "Saved" edit. Issuing now locks the draft first (a
  compare-and-set) and refuses if anyone saved since the issuer's screen
  loaded; a save that arrives while it's being issued is refused. (New
  test: thirteen interleavings, either order; whatever wins, the email, the
  record and the frozen document carry the same prices.)
- **Commissioning could be signed while the signer's own re-captured
  readings were still on the phone**, so the certificate and F-gas record
  kept the old values. **Sign** now waits (and says why) while anything for
  the job is on the phone, and the server refuses a signature over a
  reading the screen didn't show, naming it.
- **When the phone's storage stopped accepting writes, captures were kept
  only in memory while the app said they were safe.** Writes now wait for
  the database to confirm them, a dropped connection is reopened and the
  write retried, and otherwise the badge says **Keep open · N waiting** and
  the capture says it isn't kept on the phone (the survey's photo queue too).
- **Captures still waiting at sign-out were sent under the next person to
  sign in on that phone.** Each capture now carries who made it and only
  sends while they're signed in; the server refuses one that isn't the
  signed-in person's; the Me page warns before signing out.
- **A second crew phone ending a day a colleague had already ended got "Day
  N hasn't started" and its owner's clock ran overnight**, inflating the
  pilot's labour hours. It now stops that person's clock and says the day
  was already ended. (New tests, including a clock across the night the
  clocks go back, 25 October 2026.)
- **Every queued reading, issue and clock tap waited behind whichever photo
  or video was uploading, and uploads had no timeout.** Readings and issues
  now go in their own lane (only one that uses a photo waits for it), sync
  requests time out, and an upload with no progress for a minute is
  aborted and retried.

## What the final review found

The first pass of the last review before the first real customers found six problems. All six
are fixed in `069775e`, each with tests that fail without the fix
(architecture §K38):

- **A lapsed F-gas or Part P engineer could record refrigerant or
  electrical steps** by sending a backdated capture time from their phone:
  the certificate was checked against the time the phone claimed. It's now
  checked against the server's own day. The phone's time is kept for the
  record only, and never earlier than the install's start. (New tests: a
  certificate that ran out two days ago, with readings dated before it, is
  refused, and nothing is stored.)
- **Subcontractors could see the family's prices.** A subcontractor on a
  job could open that family's project page, pay page, proposal, documents
  list and every document (contract, invoices, receipts) by their address.
  Now only the customer and the office (staff with the board-wide view) open
  those; the crew (installers, the electrician, subcontractors) gets "not
  found", and opens only the commissioning certificate and the handover pack
  from the job. (New: unit tests, a check that every customer screen asks
  for it, and a pilot-walk check that the DEMO subcontractor sees no price
  on their own job's customer pages while the office does.)
- **Anyone could lock the founders out of break-glass**, the way in on
  launch day while the email domain verifies: 20 junk attempts an hour from
  anywhere filled a site-wide count. The limits now only slow the network
  sending the attempts (5 a quarter hour); the founder elsewhere is never
  refused. (New test: 21 junk attempts from one network, then the founder
  from another gets in.)
- **On a Supabase project created since 30 May 2026, the app couldn't use
  any table**, and `check-schema.sql` still said "All present". Supabase
  stopped granting new tables to the app's server key by default (and does
  the same for older projects from 30 October 2026). New migration `0014`
  (in `pilot-upgrade.sql`) grants it every table; `check-schema.sql` now
  checks the server can read and write each one; `/login`, `/ops/launch`,
  `/api/health` and the deploy log say "needs the upgrade" instead of
  failing quietly, and break-glass still opens `/ops/status`. The test
  databases now start with today's defaults (no table grants), so every walk
  above proves `0014` works; the upgrade test also models an older project
  through Supabase's switch, and a grant taken away is named by the check
  and put back by the upgrade.
- **The old site's template password worked.** Main's `.env.example`
  shipped `OPS_PASSWORD=pick-something-strong` (21 characters, so it passed
  the length check); if the live Vercel project still holds it, break-glass
  opened the admin console with a password published in the repository. It,
  and the old template inboxes (`you@dang.ac`, `you@example.com`, anything
  on `yourdomain.`), now count as not set; `/login` says when break-glass is
  off and why; START-HERE step 4 says to edit the old site's settings and
  make a new `OPS_PASSWORD`.
- **Next.js 15.5.20 had published security fixes** (15.5.21 to 15.5.28),
  among them a denial of service through server actions that every form
  here uses. It's now 15.5.28, with the hydration patch carried over
  unchanged. `pnpm audit` lists nothing against Next itself for the web app
  any more (two warnings remain inside Next's bundled PostCSS and `sharp`,
  neither reachable here: known limitation 40).

The earlier final pass (on `e21f042`) had found two problems where the
go-live pack met the Supabase compatibility work: a demo site switching
itself off on Supabase, and one unit test writing half a row. Both stayed
fixed.

## The end-to-end pilot walk, phase by phase

One new pilot household taken from set-up to closed, in a real browser, by
each person on their own device: the admin at a desk (1280 × 800), the
family, the surveyor and the crew on phones (390 × 844). The same 204 checks
passed four times on the final commit: twice on the local file database and
twice on the Supabase-shaped stack. Any page error in the browser (including the
hydration warning below) or any server error fails the walk.

| Phase | What it does | Checks | Passed |
| --- | --- | --- | --- |
| A | Admin signs in, sets up a new pilot (number typed in), owner and surveyor; a next action due today on its quote shows under **Website leads due today** and in the inbox | 12 | 12 |
| B | The family opens their emailed link, books the survey, agrees to documents by email | 9 | 9 |
| C | Surveyor on a phone: on my way, start, every section (2 rooms measured, photos, a drawing), outdoor, electrics, planning checks, risks, submit at 100% | 16 | 16 |
| D | Catalogue loaded and priced from a CSV, design drafted, layout photos chosen, sent for review, approved and signed by the technical lead | 12 | 12 |
| E | Proposal with two options and PILOT15; the design's planning or noise check is flagged, so the office adds the suggested planning and noise note; issuing is refused until the Schedule 2 settings are filled in, then it issues | 15 | 15 |
| F | The family views it (the planning and noise note included) and accepts option 1 with an early start and their typed name; the contract renders | 11 | 11 |
| G | Office: early-start email on file (one from the wrong address is refused), dates, crew certificates, deposit invoice paid by bank transfer, booking confirmed, purchase order ordered, delivered and checked, compliance approved | 19 | 19 |
| H | Install days 1 to 3 on phones: on my way, every step's evidence, an issue, a variation the family approves on their page (their next step names it, on the page and on **Your homes**, until they answer), end-of-day updates with photos, F-gas steps by the technical lead and electrical steps by the electrician | 35 | 35 |
| I | Technical lead sets the job's targets and signs commissioning; the certificate renders | 5 | 5 |
| J | Handover pack published, the family signs "All good", balance invoice paid (DEMO card simulator), electrical certificate and warranty in, issues resolved, project closed, all documents present | 30 | 30 |
| K | Every customer message logged; the Pilots page shows the pilot; the CSV downloads | 9 | 9 |
| L | Security: a duplicate pilot number, another family (pages, documents, invoices, photos), a subcontractor (office pages, other jobs, photos, margins, and on their own job the family's project, pay, proposal and documents pages and every document, while the office sees the prices there), signed-out visitors, a forged sign-in cookie, a bad Stripe signature, the demo-data button | 31 | 31 |
| | **Total** | **204** | **204** |

## The founder's walk (START-HERE, followed literally)

Earlier on 19 October (before the final pass above), someone with fresh eyes followed
[START-HERE-TOMORROW.md](../START-HERE-TOMORROW.md) steps 5 to 11 word for
word, on a production build with an empty local database, the way the live
site will look before email works: no demo sign-in, `ADMIN_EMAILS` set to
one address, `SESSION_SECRET` and `OPS_PASSWORD` set, no email, texts or
card payments. Everything typed was fictional (example.com addresses, DEMO
names).

| Step | What happened | Result |
| --- | --- | --- |
| 5 Sign in | The email link can't go without email; **Admin break-glass** with the admin address and `OPS_PASSWORD` signed in and created the admin account | Pass, after the guide fix below |
| 6 Launch checklist | Red rows for the database, email and `CRON_SECRET` (expected locally); everything the founder controls went green by step 9 | Pass |
| 7 Settings | Every field the guide names was where it said; saving turned the red box green | Pass |
| 8 Staff | A technical lead (F-gas), an electrician (Part P) and a surveyor added; evidence uploaded and ticked; both launch rows green | Pass |
| 9 Catalogue | **Load researched catalogue** added 122 items; four units given a DEMO trade price, confidence verified | Pass |
| 10 New pilot | Pilot 1 set up; the app said plainly that no link went (no email) | Pass |
| 11 The family | Their sign-in link opened **Continue as …**, then their page; they booked a survey at home and agreed to documents by email; the office saw it on the project, the calendar and in Messages | Pass |

What got in the way, and what changed:

- **No way in while the email domain verifies.** Step 4 didn't mention
  `OPS_PASSWORD`. It's now in the table, and step 5 says how to use
  **Admin break-glass** meanwhile.
- **"You land on the Board"**: you land on **Today**. Fixed in the guide.
- **Contradictory database instructions** on the login page, `/ops/status`
  and `/ops/launch` ("run every migration 0001 to 0013", "0001 → 0007"). They
  now all say the same as step 3: paste `supabase/pilot-upgrade.sql`, then
  `check-schema.sql`.
- **The launch page's headline counted the wrong things**: "4/8 automated
  checks green" sat above "3 to fix", and counted property intelligence,
  which the pilots don't need. The headline now follows the pilot checklist;
  property intelligence and analytics are marked optional.
- **The catalogue row went green on research prices alone.** Loading the
  researched catalogue prices six units from public retail websites (some
  approximate), which made both tiers look priced. The row now stays amber
  until someone types their own price in each tier (new unit test).
- **A family set up before email worked could never get their link** except
  by booking their survey. The project's **Admin** box now has **Email them
  a sign-in link** (to the address on the project only; refused, with the
  reason, while email isn't set up).
- **Message previews show "[[link added when sent]]"** where the sign-in
  button goes. That's deliberate (links are never stored); the preview now
  says so and points to **Customer view**.
- Guide clarifications: the phone and email settings start as placeholders;
  the service area starts with 17 districts; after **Add to the team** you're
  already on the person's page; rename your own staff record; how to split a
  pair price between indoor and outdoor units; the family sees the starting
  price; **Customer view**; the **Continue as …** page.

Not walked by hand: the surveyor, crew and proposal steps (the pilot walk
above covers them), and anything needing real email, Supabase or Stripe.

## The quote form walk

The public website on a phone: home page, postcode, coverage confirmed, the
reminder box under the email (offered, ticked, can be unticked), the
house and rooms steps with a price, the optional photo step, two separate
unticked consent boxes (saving without the required one is refused), the
result page ("confirmed at your survey", with its validity), **Book my home
survey** opening the project page, no placeholder phone number, and an
out-of-area postcode told the truth and its heads-up stored. **24 of 24
pass.**

## The database checks

`supabase/tests/run-migrations.sh` builds a throwaway PostgreSQL 16 database
and: starts from Supabase's default grants as a project created today has
them (none on tables); applies every migration in order, proving the
server's key can't read a table before `0014` and can after; re-applies the
pilot migrations on an empty and on a filled database (nothing changes);
runs the sanity suite (every table takes a row, the accepted-proposal guard
refuses edits, the public key can't read or write anything, the server's
key can read and write every table through the migrations' own grants, the
shared sign-in limit counts and resets); checks the local file database
enforces exactly the schema the migrations make (every column, type,
default, key and check); runs the read-only production check ("All present:
30 tables (each usable by the server), 10 columns, 3 photo stores, the
sign-in counter, the proposal guard and 3 duplicate guards"); then, on a
second database shaped like the live site before the pilots (migrations
0001 to 0009, made while Supabase still granted tables by default, then its
switch to granting nothing), runs `supabase/pilot-upgrade.sql` twice, checks
it again, runs the sanity suite again, takes grants away and proves the
check names them and the upgrade puts them back, and proves a run that
stops part-way changes nothing. 110 assertions across both sanity runs, all
passed.

## The Supabase-shaped run

`supabase/tests/compat/run-compat-e2e.sh` runs the production build against
the same interfaces a real Supabase project serves, on this machine:
Postgres 16 with Supabase's roles (every migration run as the
non-superuser `postgres`, as in the SQL editor, and no table granted to the
API roles unless a migration grants it, as on a project created today),
PostgREST 12.2.3 with Max
Rows 1000, and a gateway doing Supabase's key check, its "no UPDATE or
DELETE without a filter" rule and the Storage API. The app has no
`DATA_BACKEND`: it talks to it only through supabase-js with the
service-role key. Then:

| Walk | What it does | Round 1 | Round 2 |
| --- | --- | --- | --- |
| Pilot walk | The 204 checks above | **204 of 204** | **204 of 204** |
| Quote form | The 24 checks above | **24 of 24** | **24 of 24** |
| Property book | 3,000 sample homes imported, enriched and classified, three times what one database read returns | **3,000 / 900 / 3,000** | **3,000 / 900 / 3,000** |
| Every screen | Break-glass sign-in, the 5 DEMO pilots loaded, 284 pages over 212 routes (every ops, field, customer and public screen, help pages included), 141 requests with ids that don't exist or aren't ids (a 404, never a crash), a NUL character in the quote form (saved without it), 4 CSV exports, 4 daily jobs | **439 of 439** | **439 of 439** |
| Postgres log | Any statement the database refused | **None** | **None** |
| App log | Any PostgREST or Storage error the app logged, even on a page that still rendered | **None** | **None** |

**The hydration warning is gone.** Earlier on 19 October one pilot walk in
three failed its "no page errors" check on a React hydration warning
(#418), more often on Supabase's slower answers. The cause was a bug in the
React that Next.js ships, now patched (`patches/next@15.5.28.patch`,
architecture §K36). No browser walk in either round saw it (ten walks: two
pilot walks, two quote-form walks and one screen walk per round).

## Not covered by these checks

- The real outside services: these walks use demo email and texts (recorded,
  not sent) and the DEMO card simulator, not Resend, Twilio or Stripe.
  After going live, send yourself a test email and walk the quote form once
  on the live site (`/ops/launch` lists it). With no email provider the
  email budgets are never spent and the unfinished-quote reminder doesn't
  run, so the walks don't exercise them: unit tests do, with a stand-in
  provider (the reminder through its real daily job).
- A real Supabase project: the Supabase-shaped run uses the same database,
  PostgREST version and Storage API calls, on this machine, but not
  Supabase's own servers, their network delays or their photo storage.
  After step 3 of START-HERE, `check-schema.sql` and `/ops/launch` check the
  real one.
- Real phones: the walks use a phone-sized Chromium, not Safari on an
  iPhone. Try the field app on each installer's own phone before day 1.
  Safari dropping the phone's storage, a weak link stalling an upload and
  two phones racing are covered by unit tests (a fake IndexedDB, a fake
  upload, concurrent server calls), not on real devices.

## Running them yourself (for a developer)

```bash
pnpm -r typecheck
pnpm test
pnpm --filter @aircon/web build
bash supabase/tests/run-migrations.sh

# Browser walks: start a production build on a fresh local data folder…
cd apps/web && DATA_BACKEND=file LOCAL_DATA_DIR=$(mktemp -d) ALLOW_DEMO_LOGIN=1 \
  SESSION_SECRET=<at least 32 characters> PORT=3330 npx next start
# …then, from the repository root, in another terminal:
BASE_URL=http://localhost:3330 pnpm --filter @aircon/web test:e2e:pilot
BASE_URL=http://localhost:3330 pnpm --filter @aircon/web test:e2e

# The Supabase-shaped run: builds, starts the stack and the app, runs every walk, tears down.
bash supabase/build-pilot-upgrade.sh --check
bash supabase/tests/compat/run-compat-e2e.sh

# The handover, 30 times, on the Supabase-shaped stack slowed down (60 ms + up to 240 ms a request):
LOOPS=30 GATEWAY_LATENCY_MS=60 GATEWAY_JITTER_MS=240 bash supabase/tests/compat/run-handover-loop.sh
# …or on the local file database, against the server above (on a fresh data folder):
BASE_URL=http://localhost:3330 E2E_UNTIL=I E2E_IDS_FILE=/tmp/ids.json node apps/web/scripts/e2e-pilot.mjs
BASE_URL=http://localhost:3330 IDS_FILE=/tmp/ids.json LOCAL_DATA_DIR=<that folder> LOOPS=30 node apps/web/scripts/e2e-handover-loop.mjs
```

Use a fresh `LOCAL_DATA_DIR` for each pilot walk. Against the live site, only
the quote form walk is safe to run (`BASE_URL=https://<your-domain>`).
