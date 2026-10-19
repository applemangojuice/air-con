# Test results

The latest real results of every automatic check, run on **19 October
2026** on branch `claude/pilot-ops` at commit `069775e` (the go-live pack
merged with the Supabase compatibility work, plus the six fixes from the
final pre-launch review [below](#what-the-final-review-found)). Everything
was run **twice, start to finish, and passed both times**. Every person,
home and price the browser walks use is fictional and labelled DEMO.

**Summary: everything passed, on both databases.** 878 unit tests, the type
check, the production build (Next.js 15.5.28), every database migration
check (110 assertions) and the upgrade file check; then the browser walks on
**both** backends: on the local file database, 193 end-to-end pilot checks
and 23 quote-form checks; on a Supabase-shaped stack (Postgres 16, PostgREST
and the Storage API, as a real Supabase project serves them, with the
database's default grants as a project created today has them), the same
193 and 23, the property book importers over 3,000 homes, and 439 checks
across 284 screens, with no statement refused by the database.

| Check | Command | Result | Round 1 (UTC) | Round 2 (UTC) |
| --- | --- | --- | --- | --- |
| Type check (domain, web, mobile) | `pnpm -r typecheck` | **Pass** (3 of 3 projects) | 18:24 | 18:46 |
| Domain unit tests | `pnpm test` | **457 of 457 pass**, 0 fail (29 test files) | 18:24 to 18:25 | 18:46 to 18:47 |
| Web unit tests | `pnpm test` | **421 of 421 pass**, 0 fail (49 test files) | 18:24 to 18:25 | 18:46 to 18:47 |
| Production build | `pnpm --filter @aircon/web build` | **Pass**: Next.js 15.5.28, compiled, 34 of 34 static pages generated | 18:26 to 18:27 | 18:47 to 18:48 |
| Database migrations | `bash supabase/tests/run-migrations.sh` | **Pass**: 15 migrations and the pilot upgrade bundle; the local backend's schema matches; 110 sanity assertions | 18:18 | 18:48 |
| Upgrade file is current | `bash supabase/build-pilot-upgrade.sh --check` | **Pass**: `pilot-upgrade.sql` is current (0010 to 0014) | 18:18 and 18:45 | 18:48 |
| Pilot walk, **local file database** | `node scripts/e2e-pilot.mjs` | **193 of 193 pass** | 18:28 to 18:33 | 18:48 to 18:53 |
| Quote form walk, **local file database** | `node scripts/e2e-funnel.mjs` | **23 of 23 pass** | 18:34 | 18:53 |
| Pilot walk, **Supabase-shaped** | `bash supabase/tests/compat/run-compat-e2e.sh` | **193 of 193 pass** | 18:35 to 18:45 | 18:54 to 19:05 |
| Quote form walk, **Supabase-shaped** | (same run) | **23 of 23 pass** | (same run) | (same run) |
| Property book import, **Supabase-shaped** | (same run) | **Pass**: 3,000 homes, 900 in a conservation area, 3,000 classified (three times Max Rows) | (same run) | (same run) |
| Every screen, **Supabase-shaped** | (same run) | **439 of 439 pass**: 284 pages over 212 routes, 141 requests with ids that aren't there, a NUL in the quote form, 4 CSV exports, 4 daily jobs | (same run) | (same run) |
| Database and app logs, **Supabase-shaped** | (same run) | **Clean**: no statement refused by Postgres, no PostgREST or Storage error in the app's log | (same run) | (same run) |

Round 1 ran on the working tree that became `069775e` (after it, only
comments and these documents changed); round 2 ran on the commit itself.

Set-up for the local walks: a production build (`next start`) on the local
file database (which enforces the same schema Postgres does), a fresh
empty data folder each round, demo sign-in on, `SESSION_SECRET` of 40
characters, headless Chromium 1194. For the Supabase-shaped walks: the same
build with **no** `DATA_BACKEND`, talking to the stack only through
supabase-js with the service-role key, as a demo deployment
(`ALLOW_DEMO_LOGIN=1 DEMO_DEPLOYMENT=1`), the route walk signing in by
**Admin break-glass**. Node 22.22.0, pnpm 10.12.1, PostgreSQL 16.15,
PostgREST 12.2.3.

## What the final review found

A last review before the first real customers found six problems. All six
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
  neither reachable here: known limitation 34).

The earlier final pass (on `e21f042`) had found two problems where the
go-live pack met the Supabase compatibility work: a demo site switching
itself off on Supabase, and one unit test writing half a row. Both stayed
fixed.

## The end-to-end pilot walk, phase by phase

One new pilot household taken from set-up to closed, in a real browser, by
each person on their own device: the admin at a desk (1280 × 800), the
family, the surveyor and the crew on phones (390 × 844). The same 193 checks
passed four times on the final commit: twice on the local file database and
twice on the Supabase-shaped stack. Any page error in the browser (including the
hydration warning below) or any server error fails the walk.

| Phase | What it does | Checks | Passed |
| --- | --- | --- | --- |
| A | Admin signs in, sets up a new pilot (number typed in), owner and surveyor | 9 | 9 |
| B | The family opens their emailed link, books the survey, agrees to documents by email | 9 | 9 |
| C | Surveyor on a phone: on my way, start, every section (2 rooms measured, photos, a drawing), outdoor, electrics, planning checks, risks, submit at 100% | 16 | 16 |
| D | Catalogue loaded and priced from a CSV, design drafted, layout photos chosen, sent for review, approved and signed by the technical lead | 12 | 12 |
| E | Proposal with two options and PILOT15; issuing is refused until the Schedule 2 settings are filled in, then it issues | 12 | 12 |
| F | The family views it and accepts option 1 with an early start and their typed name; the contract renders | 10 | 10 |
| G | Office: early-start email on file (one from the wrong address is refused), dates, crew certificates, deposit invoice paid by bank transfer, booking confirmed, purchase order ordered, delivered and checked, compliance approved | 19 | 19 |
| H | Install days 1 to 3 on phones: on my way, every step's evidence, an issue, a variation the family approves on their page, end-of-day updates with photos, F-gas steps by the technical lead and electrical steps by the electrician | 31 | 31 |
| I | Technical lead sets the job's targets and signs commissioning; the certificate renders | 5 | 5 |
| J | Handover pack published, the family signs "All good", balance invoice paid (DEMO card simulator), electrical certificate and warranty in, issues resolved, project closed, all documents present | 30 | 30 |
| K | Every customer message logged; the Pilots page shows the pilot; the CSV downloads | 9 | 9 |
| L | Security: a duplicate pilot number, another family (pages, documents, invoices, photos), a subcontractor (office pages, other jobs, photos, margins, and on their own job the family's project, pay, proposal and documents pages and every document, while the office sees the prices there), signed-out visitors, a forged sign-in cookie, a bad Stripe signature, the demo-data button | 31 | 31 |
| | **Total** | **193** | **193** |

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
house and rooms steps with a price, the optional photo step, two separate
unticked consent boxes (saving without the required one is refused), the
result page ("confirmed at your survey", with its validity), **Book my home
survey** opening the project page, no placeholder phone number, and an
out-of-area postcode told the truth and its heads-up stored. **23 of 23
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
| Pilot walk | The 193 checks above | **193 of 193** | **193 of 193** |
| Quote form | The 23 checks below | **23 of 23** | **23 of 23** |
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
  on the live site (`/ops/launch` lists it).
- A real Supabase project: the Supabase-shaped run uses the same database,
  PostgREST version and Storage API calls, on this machine, but not
  Supabase's own servers, their network delays or their photo storage.
  After step 3 of START-HERE, `check-schema.sql` and `/ops/launch` check the
  real one.
- Real phones: the walks use a phone-sized Chromium, not Safari on an
  iPhone. Try the field app on each installer's own phone before day 1.

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
```

Use a fresh `LOCAL_DATA_DIR` for each pilot walk. Against the live site, only
the quote form walk is safe to run (`BASE_URL=https://<your-domain>`).
